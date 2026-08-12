#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сбор идей и багов от участников общего чата (v2.2.4).

Участник пишет в группу:
    /идея <текст>   — предложение по улучшению
    /баг <текст>    — сообщение о проблеме

Записи попадают во вкладку «Бэклог BL-6» в таблице реестра поручений.
Владелец периодически просматривает вкладку и меняет статусы:
Новое → В работе → Сделано / Отклонено.

Модуль автономен: свои пути к конфигу и свой gspread-клиент, чтобы
минимизировать пересечения с параллельными правками bot_handler.py.
"""

import os
import json
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.join(SCRIPT_DIR, '..')
CREDS_DIR = os.path.join(SKILL_DIR, '.credentials')
CONFIG_PATH = os.path.join(CREDS_DIR, 'config.json')

MSK = timezone(timedelta(hours=3))

FEEDBACK_SHEET = "Бэклог BL-6"
FEEDBACK_HEADERS = ["№", "Дата", "Автор", "Тип", "Текст", "Статус", "Комментарий"]
STATUS_NEW = "Новое"

MAX_TEXT_LEN = 1000  # защита от простыней

# Команды-триггеры (регистронезависимо), с упоминанием бота или без
_CMD_ALIASES = {
    "/идея": "Идея",
    "/idea": "Идея",
    "/баг": "Баг",
    "/bug": "Баг",
}


def parse_feedback_command(text: str,
                           bot_username: str = "") -> Optional[Tuple[str, str]]:
    """Распознаёт команду фидбека. Возвращает (тип, текст) или None.

    Поддерживает: '/идея текст', '/баг текст', '/bug текст', '/idea текст',
    с упоминанием бота ('/идея@Plaxotin_task_bot текст'), регистронезависимо.
    Упоминание чужого бота → None (не наше сообщение).
    """
    if not text:
        return None
    stripped = text.strip()
    first, _, rest = stripped.partition(" ")
    cmd = first.split("@", 1)[0].lower()
    if "@" in first and bot_username:
        mention = first.split("@", 1)[1].lower()
        if mention != bot_username.lower():
            return None
    fb_type = _CMD_ALIASES.get(cmd)
    if not fb_type:
        return None
    return fb_type, rest.strip()


def _load_config() -> dict:
    if not os.path.exists(CONFIG_PATH):
        return {}
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _now_msk() -> datetime:
    return datetime.now(timezone.utc).astimezone(MSK)


def _get_feedback_sheet(log_fn=print):
    """Лист «Бэклог BL-6»; создаётся при первом обращении."""
    import gspread
    from google.oauth2.service_account import Credentials

    creds_file = os.path.join(CREDS_DIR, 'gsheets-service-account.json')
    scopes = ['https://www.googleapis.com/auth/spreadsheets',
              'https://www.googleapis.com/auth/drive']
    creds = Credentials.from_service_account_file(creds_file, scopes=scopes)
    client = gspread.authorize(creds)

    spreadsheet_id = _load_config().get('spreadsheet_id')
    if not spreadsheet_id:
        raise RuntimeError("spreadsheet_id не задан в config.json")
    spreadsheet = client.open_by_key(spreadsheet_id)

    try:
        ws = spreadsheet.worksheet(FEEDBACK_SHEET)
    except Exception:
        ws = spreadsheet.add_worksheet(title=FEEDBACK_SHEET, rows=1000,
                                       cols=len(FEEDBACK_HEADERS))
        end_col = chr(ord('A') + len(FEEDBACK_HEADERS) - 1)
        rng = f"A1:{end_col}1"
        ws.update(range_name=rng, values=[FEEDBACK_HEADERS])
        ws.format(rng, {'textFormat': {'bold': True},
                        'backgroundColor': {'red': 0.9, 'green': 0.9,
                                            'blue': 0.9}})
        if log_fn:
            log_fn(f"Создана вкладка «{FEEDBACK_SHEET}» для бэклога идей/багов")
    return ws


def _next_number(ws) -> int:
    values = ws.get_all_values()
    nums = []
    for row in values[1:]:
        if row and row[0].isdigit():
            nums.append(int(row[0]))
    return max(nums) + 1 if nums else 1


def add_feedback(username: str, fb_type: str, text: str, log_fn=print) -> int:
    """Добавляет запись в бэклог. Возвращает номер записи."""
    text = text.strip()[:MAX_TEXT_LEN]
    ws = _get_feedback_sheet(log_fn=log_fn)
    num = _next_number(ws)
    author = f"@{username}" if username else "?"
    ws.append_row([
        num,
        _now_msk().strftime("%d.%m.%Y %H:%M"),
        author,
        fb_type,
        text,
        STATUS_NEW,
        "",
    ])
    return num


def count_by_status(status: str = STATUS_NEW) -> int:
    """Сколько записей в статусе (для будущего дайджеста бэклога)."""
    try:
        ws = _get_feedback_sheet(log_fn=None)
        values = ws.get_all_values()
        return sum(1 for row in values[1:] if len(row) > 5 and row[5] == status)
    except Exception:
        return 0
