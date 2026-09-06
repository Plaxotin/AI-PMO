#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Загрузка конфигов BL-1 из .credentials/ (вне репо, как у BL-6).

Файлы:
  telegram.json — {"bot_token": "...", "admin_ids": [107227641]}
  kimi.json     — {"api_key": "...", "base_url": "https://api.moonshot.ai/v1",
                   "model": "kimi-k2.6"}
"""

import json
import os
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CREDS_DIR = os.path.join(SCRIPT_DIR, '..', '.credentials')


def _load(name: str) -> Optional[dict]:
    path = os.path.join(CREDS_DIR, name)
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def load_telegram_config() -> Optional[dict]:
    cfg = _load('telegram.json')
    if not cfg or not cfg.get('bot_token'):
        return None
    return cfg


def load_kimi_config() -> Optional[dict]:
    cfg = _load('kimi.json')
    if not cfg or not cfg.get('api_key'):
        return None
    return cfg
