#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Парсер текстовых команд бота @Plaxotin_task_bot (BL-6, v3.0).

v3.0:
  - Для админов: ТОЛЬКО свободная форма через LLM.
    Канонические команды полностью отключены (кроме help/registry_link).
  - Для обычных пользователей: оставлены команды просмотра и закрытия
    своих поручений (list_my, list_all, list_project, list_status, close, help, registry_link).
"""

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Dict, Optional


@dataclass
class ParsedCommand:
    ok: bool
    name: str = ""
    args: Dict = field(default_factory=dict)
    error: str = ""


_WEEKDAYS = {
    "понедельник": 0, "вторник": 1,
    "среда": 2, "среду": 2,
    "четверг": 3,
    "пятница": 4, "пятницу": 4,
    "суббота": 5, "субботу": 5,
    "воскресенье": 6,
}

_DATE_ERROR = (
    "Не понял дату «{value}».\n"
    "Форматы: <code>20.08.2026</code>, <code>20.08</code>, "
    "<code>завтра</code>, <code>послезавтра</code>, <code>в пятницу</code>."
)


def normalize_date(text: str, today: Optional[date] = None) -> Optional[str]:
    if today is None:
        today = date.today()
    s = text.strip().lower()
    if s == "сегодня":
        return today.strftime("%d.%m.%Y")
    if s == "завтра":
        return (today + timedelta(days=1)).strftime("%d.%m.%Y")
    if s == "послезавтра":
        return (today + timedelta(days=2)).strftime("%d.%m.%Y")
    m = re.match(r"^(?:в|во)\s+([а-яё]+)$", s)
    if m and m.group(1) in _WEEKDAYS:
        target = _WEEKDAYS[m.group(1)]
        delta = (target - today.weekday()) % 7
        return (today + timedelta(days=delta)).strftime("%d.%m.%Y")
    m = re.match(r"^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$", s)
    if m:
        day, month = int(m.group(1)), int(m.group(2))
        if m.group(3):
            year = int(m.group(3))
            if year < 100:
                year += 2000
        else:
            year = today.year
            try:
                if date(year, month, day) < today:
                    year += 1
            except ValueError:
                return None
        try:
            return date(year, month, day).strftime("%d.%m.%Y")
        except ValueError:
            return None
    return None


def help_text(role: str = "user") -> str:
    if role == "admin":
        return ("💬 Напишите мне любую задачу по изменению реестра поручений "
                "в свободной форме — я пойму, внесу правки и пришлю "
                "подтверждение.")
    return ("📋 Кнопка <b>«Мои поручения»</b> — ваши открытые поручения "
            "из реестра, закрытие в один тап.")


def unknown_command(role: str = "user") -> ParsedCommand:
    return ParsedCommand(
        ok=False,
        error="🤔 Не понял команду.\n\n" + help_text(role),
    )


def route_unrecognized(role: str) -> str:
    return "llm" if role == "admin" else "fallback"


# ======== ДОСТУП ========
# Все команды доступны только обычным пользователям.
# Админы используют только LLM (свободная форма).
_PUBLIC_COMMANDS = {"help", "registry_link", "list_my", "list_all",
                    "list_project", "list_status", "close"}


def _check_access(name: str, role: str) -> Optional[ParsedCommand]:
    if name in _PUBLIC_COMMANDS:
        return None
    # Админские команды отключены в v3.0
    return ParsedCommand(
        ok=False,
        error="🔒 Эта функция доступна только через свободную форму (админам).",
    )


def parse(text: str, role: str = "user",
          today: Optional[date] = None) -> ParsedCommand:
    """Разбирает текст команды (v3.0).

    Для admin: почти ничего не распознаём (только help/registry_link),
    всё остальное → unknown → LLM.
    Для user: стандартный набор команд просмотра/закрытия.
    """
    norm = re.sub(r"\s+", " ", (text or "").strip())
    low = norm.lower()

    if not norm:
        return unknown_command(role)

    def finish(name: str, args: Dict) -> ParsedCommand:
        denial = _check_access(name, role)
        if denial is not None:
            return denial
        return ParsedCommand(ok=True, name=name, args=args)

    # --- справка (всем) ---
    if low in ("помощь", "справка", "команды", "help", "/start", "/help", "старт"):
        return finish("help", {})

    # --- ссылка на реестр (всем) ---
    if low == "реестр":
        return finish("registry_link", {})

    # --- Для админов: всё остальное → unknown → LLM ---
    if role == "admin":
        return unknown_command(role)

    # --- просмотр (только обычным пользователям) ---
    if low == "мои поручения":
        return finish("list_my", {})
    if low in ("все поручения", "всё поручения", "все поручение"):
        return finish("list_all", {})

    m = re.match(r"^поручения\s+статус\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        return finish("list_status", {"status": m.group(1).strip()})

    m = re.match(r"^поручения\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        return finish("list_project", {"project": m.group(1).strip()})

    # --- закрытие (только своё — проверка в обработчике) ---
    m = re.match(r"^закрыть\s*#\s*(\d+)$", low) or re.match(r"^закрыть\s+(\d+)$", low)
    if m:
        return finish("close", {"id": int(m.group(1))})

    return unknown_command(role)


def parse_canonical(text: str, today: Optional[date] = None) -> ParsedCommand:
    """Разбирает каноническую команду, возвращённую interpret_free_text (LLM).
    Без проверки роли — используется только для подтверждённых LLM-команд.
    """
    norm = re.sub(r"\s+", " ", (text or "").strip())
    low = norm.lower()

    if not norm:
        return ParsedCommand(ok=False)

    def finish(name: str, args: Dict) -> ParsedCommand:
        return ParsedCommand(ok=True, name=name, args=args)

    # --- справка ---
    if low in ("помощь", "справка", "команды", "help", "/start", "/help", "старт"):
        return finish("help", {})

    # --- ссылка на реестр ---
    if low == "реестр":
        return finish("registry_link", {})

    # --- просмотр ---
    if low == "мои поручения":
        return finish("list_my", {})
    if low in ("все поручения", "всё поручения", "все поручение"):
        return finish("list_all", {})

    m = re.match(r"^поручения\s+статус\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        return finish("list_status", {"status": m.group(1).strip()})

    m = re.match(r"^поручения\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        return finish("list_project", {"project": m.group(1).strip()})

    # --- закрытие ---
    m = re.match(r"^закрыть\s*#\s*(\d+)$", low) or re.match(r"^закрыть\s+(\d+)$", low)
    if m:
        return finish("close", {"id": int(m.group(1))})

    # --- дайджест ---
    if low == "дайджест":
        return finish("digest", {})

    # --- подключить реестр ---
    m = re.match(r"^подключить\s+реестр\s+(.+?)\s+(https?://\S+|[A-Za-z0-9_-]{20,})$",
                 norm, flags=re.IGNORECASE)
    if m:
        return finish("connect_registry",
                      {"title": m.group(1).strip(), "url": m.group(2).strip()})

    # --- новый реестр ---
    m = re.match(r"^новый\s+реестр\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        return finish("new_registry", {"title": m.group(1).strip()})

    # --- переключить реестр ---
    m = re.match(r"^переключить\s+реестр\s+на\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        return finish("switch_registry", {"name": m.group(1).strip()})

    # --- срок ---
    m = re.match(r"^срок\s*#\s*(\d+)\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        date_str = normalize_date(m.group(2).strip(), today)
        if date_str:
            return finish("deadline", {"id": int(m.group(1)), "date": date_str})
        return ParsedCommand(ok=False, error=f"❌ Не удалось распознать дату: {m.group(2).strip()}")

    # --- статус ---
    m = re.match(r"^статус\s*#\s*(\d+)\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        return finish("status", {"id": int(m.group(1)), "status": m.group(2).strip()})

    # --- ответственный ---
    m = re.match(r"^ответственный\s*#\s*(\d+)\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        return finish("assignee", {"id": int(m.group(1)), "assignee": m.group(2).strip()})

    # --- описание ---
    m = re.match(r"^описание\s*#\s*(\d+)\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        return finish("description", {"id": int(m.group(1)), "description": m.group(2).strip()})

    # --- комментарий ---
    m = re.match(r"^комментарий\s*#\s*(\d+)\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        return finish("comment", {"id": int(m.group(1)), "comment": m.group(2).strip()})

    # --- удалить ---
    m = re.match(r"^удалить\s*#\s*(\d+)$", low) or re.match(r"^удалить\s+(\d+)$", low)
    if m:
        return finish("delete", {"id": int(m.group(1))})

    # --- создать поручение ---
    m = re.match(r"^создать\s+поручение:\s*(.+)$", norm, flags=re.IGNORECASE)
    if m:
        parts = {}
        for part in m.group(1).split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                parts[k.strip().lower()] = v.strip()
        contragent = (parts.get("контрагент") or parts.get("компания")
                      or parts.get("ка") or "")
        description = parts.get("описание", "")
        assignee = parts.get("ответственный", "")
        deadline_str = parts.get("срок", "")
        if not contragent or not description or not assignee or not deadline_str:
            return ParsedCommand(ok=False, error="❌ Неполные данные для создания поручения.")
        date_str = normalize_date(deadline_str, today)
        if not date_str:
            return ParsedCommand(ok=False, error=f"❌ Не удалось распознать дату: {deadline_str}")
        return finish("create", {
            "contragent": contragent,
            "description": description,
            "assignee": assignee,
            "deadline": date_str,
        })

    return ParsedCommand(ok=False)
