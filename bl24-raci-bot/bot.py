"""BL-24 «Генератор RACI» — Telegram-бот (aiogram 3, LLM: Kimi/Moonshot).

Запуск:  set BOT_TOKEN=... && set KIMI_API_KEY=... && python bot.py
Без KIMI_API_KEY бот работает в демо-режиме (встроенный пример MES).
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from pathlib import Path

from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    BufferedInputFile, CallbackQuery, InlineKeyboardButton,
    InlineKeyboardMarkup, Message,
)

import raci_engine
import xlsx_builder
from kimi_client import KimiError

logging.basicConfig(level=logging.INFO)

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
MAX_DESCRIPTION = 4000


class Form(StatesGroup):
    waiting_description = State()
    confirm = State()
    choose_mode = State()


KB_CONFIRM = InlineKeyboardMarkup(inline_keyboard=[[
    InlineKeyboardButton(text="✅ Генерировать", callback_data="gen"),
    InlineKeyboardButton(text="✏️ Уточнить описание", callback_data="edit"),
]])
KB_MODE = InlineKeyboardMarkup(inline_keyboard=[[
    InlineKeyboardButton(text="⚡ Быстрее", callback_data="mode_fast"),
    InlineKeyboardButton(text="📋 С рекомендациями", callback_data="mode_guided"),
]])

WELCOME = (
    "👋 Привет! Я генерирую <b>RACI-матрицу</b> по методологии PMBOK "
    "(Responsible · Accountable · Consulted · Informed) и присылаю её в Excel.\n\n"
    "1️⃣ Опишите проект: цель, состав работ, кто участвует (роли), ключевые фазы.\n"
    "2️⃣ Я сгенерирую матрицу и пришлю файл .xlsx.\n\n"
    "⚠️ <b>Конфиденциальность (152-ФЗ):</b> не отправляйте персональные данные, "
    "коммерческую тайну и иные чувствительные сведения — используйте роли "
    "(«Спонсор», «Команда разработки»), а не ФИО.\n\n"
    "Жму /start — и просто пришлите описание проекта."
)


async def on_start(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(WELCOME)
    await state.set_state(Form.waiting_description)


async def on_description(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    if not text:
        await message.answer("Пришлите описание проекта текстом.")
        return
    if len(text) > MAX_DESCRIPTION:
        text = text[:MAX_DESCRIPTION]
        await message.answer(f"Описание обрезано до {MAX_DESCRIPTION} символов.")
    await state.update_data(description=text)
    preview = text[:600] + ("…" if len(text) > 600 else "")
    await message.answer(
        f"📝 Понял так:\n\n<i>{preview}</i>\n\nВсё верно?",
        reply_markup=KB_CONFIRM,
    )
    await state.set_state(Form.confirm)


async def on_confirm(callback: CallbackQuery, state: FSMContext) -> None:
    if callback.data == "edit":
        await callback.message.answer("Хорошо, пришлите уточнённое описание проекта.")
        await state.set_state(Form.waiting_description)
    else:
        await callback.message.answer("Выберите режим генерации:", reply_markup=KB_MODE)
        await state.set_state(Form.choose_mode)
    await callback.answer()


async def on_mode(callback: CallbackQuery, state: FSMContext) -> None:
    mode = "fast" if callback.data == "mode_fast" else "guided"
    data = await state.get_data()
    description = data.get("description", "")
    await callback.message.answer("⏳ Генерирую RACI-матрицу…")
    await callback.answer()
    try:
        result, issues = await asyncio.to_thread(raci_engine.generate, description, mode)
    except KimiError as exc:
        await callback.message.answer(
            "😔 LLM-сервис временно недоступен. Попробуйте позже.\n"
            f"<i>{exc}</i>"
        )
        await state.clear()
        return
    except Exception:  # noqa: BLE001
        logging.exception("generation failed")
        await callback.message.answer("😔 Не удалось сформировать матрицу. Попробуйте переформулировать описание.")
        await state.clear()
        return

    roles = result.get("roles") or []
    activities = result.get("activities") or []
    if issues:
        warn = "\n".join(f"• {i}" for i in issues[:5])
        await callback.message.answer(f"⚠️ Замечания валидации PMBOK:\n{warn}")

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "raci_matrix.xlsx"
        await asyncio.to_thread(xlsx_builder.build_xlsx, result, str(path))
        payload = path.read_bytes()

    await callback.message.answer_document(
        BufferedInputFile(payload, filename=f"RACI_{(result.get('project_name') or 'project')[:40]}.xlsx"),
        caption=(
            f"📊 RACI-матрица: {result.get('project_name', 'проект')}\n"
            f"Активностей: {len(activities)} · Ролей: {len(roles)}\n\n"
            "Пришлите новое описание, чтобы построить ещё одну матрицу."
        ),
    )
    await state.set_state(Form.waiting_description)


def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("Задайте BOT_TOKEN (токен от @BotFather).")
    dp = Dispatcher()
    dp.message.register(on_start, CommandStart())
    dp.message.register(on_description, Form.waiting_description)
    dp.callback_query.register(on_confirm, Form.confirm)
    dp.callback_query.register(on_mode, Form.choose_mode)
    asyncio.run(dp.start_polling(Bot(BOT_TOKEN)))


if __name__ == "__main__":
    main()
