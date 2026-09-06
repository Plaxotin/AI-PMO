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
