#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Загрузка конфигов BL-36 из .credentials/ (вне репо, паттерн BL-6/BL-1).

Файлы:
  telegram.json — {"bot_token": "...", "owner_id": 107227641, "admin_ids": [...]}
  kimi.json     — {"api_key": "...", "base_url": "https://api.moonshot.ai/v1",
                   "model": "kimi-k2.6"}
  supabase.json — {"url": "https://<proj>.supabase.co", "service_key": "..."}
  config.json   — {"project_id": "default", "sense_interval_sec": 1800,
                   "digest_time_msk": "09:17", "digest_chat_id": null,
                   "confidence_threshold": 0.5, "min_message_chars": 25}
"""

import json
import os
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CREDS_DIR = os.path.join(SCRIPT_DIR, '..', '.credentials')

DEFAULTS = {
    'project_id': 'default',
    'sense_interval_sec': 1800,
    'digest_time_msk': '09:17',
    'digest_chat_id': None,
    'confidence_threshold': 0.5,
    'min_message_chars': 25,
}


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


def load_supabase_config() -> Optional[dict]:
    cfg = _load('supabase.json')
    if not cfg or not cfg.get('url') or not cfg.get('service_key'):
        return None
    return cfg


def load_config() -> dict:
    cfg = _load('config.json') or {}
    merged = dict(DEFAULTS)
    merged.update(cfg)
    return merged


def save_config(cfg: dict):
    """Сохранить config.json (переключатели вроде digest_auto)."""
    path = os.path.join(CREDS_DIR, 'config.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=1)
