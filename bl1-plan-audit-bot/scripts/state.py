#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""История присланных планов по чатам (BL-1).

Храним ТОЛЬКО метаданные (file_id, имя файла, дата) — сами файлы остаются
в истории Telegram и при необходимости пересскачиваются через getFile.
Файлы плана на сервере не сохраняются (stateless по контенту).
"""

import json
import os
from datetime import datetime
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(SCRIPT_DIR, 'state.json')
MAX_PER_CHAT = 5


def _load() -> dict:
    if not os.path.exists(STATE_PATH):
        return {}
    try:
        with open(STATE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _save(state: dict) -> None:
    with open(STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def remember_plan(chat_id: int, file_id: str, file_name: str) -> None:
    state = _load()
    items = state.setdefault(str(chat_id), [])
    items.append({'file_id': file_id, 'file_name': file_name,
                  'ts': datetime.now().isoformat(timespec='seconds')})
    state[str(chat_id)] = items[-MAX_PER_CHAT:]
    _save(state)


def last_plan(chat_id: int) -> Optional[dict]:
    items = _load().get(str(chat_id), [])
    return items[-1] if items else None


def previous_plan(chat_id: int) -> Optional[dict]:
    """Предпоследний присланный план — база для диффа."""
    items = _load().get(str(chat_id), [])
    return items[-2] if len(items) >= 2 else None


# ---------- Кэш последнего аудита (drill-down, спонсорский отчёт) ----------
# Факты анализа (метаданные, не файл плана) сохраняются на диск — кнопки
# детализации и «Отчёт для спонсора» работают и после перезапуска бота
# (решение 13.09.26: «сессия не должна устаревать»).

LASTRUN_PATH = os.path.join(SCRIPT_DIR, 'last_run.json')


def save_last_run(chat_id: int, plan_name: str, facts: dict) -> None:
    try:
        data = {}
        if os.path.exists(LASTRUN_PATH):
            with open(LASTRUN_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
        data[str(chat_id)] = {
            'plan_name': plan_name, 'facts': facts,
            'ts': datetime.now().isoformat(timespec='seconds')}
        with open(LASTRUN_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, default=str)
    except Exception as e:
        print(f'⚠️ не удалось сохранить last_run: {e}')


def load_last_run(chat_id: int) -> Optional[dict]:
    try:
        with open(LASTRUN_PATH, 'r', encoding='utf-8') as f:
            return json.load(f).get(str(chat_id))
    except Exception:
        return None
