#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LLM-режим свободной формы (BL-6, v2.2) — только админы/суперадмин, только личка.

Переводит свободную просьбу админа в КАНОНИЧЕСКУЮ текстовую команду бота
(через Kimi / Moonshot, OpenAI-совместимый API). Дальше канонический текст
проходит обычный путь: commands.parse → подтверждение «да» → dispatch
со всеми проверками прав и аудитом.

Конфиг: .credentials/kimi.json {"api_key": "...", "base_url": "...",
"model": "..."}. Файл с ключом НЕ коммитим.
"""

import json
import os
import re
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CREDS_DIR = os.path.join(SCRIPT_DIR, '..', '.credentials')
KIMI_CONFIG = os.path.join(CREDS_DIR, 'kimi.json')

TIMEOUT = 60          # секунд на вызов API
MAX_TOKENS = 1000
TEMPERATURE = 0.1

SYSTEM_PROMPT = """Ты — транслятор просьб в команды Telegram-бота реестра поручений.

Сегодняшняя дата: {today} (используй для относительных дат: «завтра», «в пятницу» и т.п.).

Переведи просьбу пользователя в ОДНУ каноническую команду бота.
Допустимые команды (строго в этих форматах):
- создать поручение: Проект=<проект>; Описание=<описание>; Ответственный=<имя>; Срок=<дата>
- закрыть #N
- срок #N <дата>          (изменить срок; дата ДД.ММ.ГГГГ или «завтра», «в пятницу»)
- статус #N <статус>      (статусы: Новое, В работе, На проверке, Выполнено, Отменено)
- ответственный #N <имя>
- описание #N <текст>
- комментарий #N <текст>
- удалить #N
- мои поручения
- все поручения
- поручения <проект>
- поручения статус <статус>
- дайджест
- реестр
- новый реестр <название>

Ответь СТРОГО одним JSON-объектом без пояснений и markdown:
{{"command_text": "<каноническая команда>"}}
или, если просьбу нельзя свести к команде:
{{"command_text": null}}"""


def load_kimi_config() -> Optional[dict]:
    """Читает .credentials/kimi.json. None, если файла нет или он битый."""
    if not os.path.exists(KIMI_CONFIG):
        return None
    try:
        with open(KIMI_CONFIG, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        if not cfg.get('api_key'):
            return None
        return cfg
    except Exception:
        return None


def extract_json(text: str) -> Optional[dict]:
    """Достаёт JSON-объект из ответа модели (терпимо к ```json-обёрткам).

    Чистая функция — покрыта юнит-тестами.
    """
    if not text:
        return None
    # срезаем markdown-обёртку, если есть
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    candidate = m.group(1) if m else None
    if candidate is None:
        m = re.search(r"\{.*\}", text, flags=re.DOTALL)
        candidate = m.group(0) if m else None
    if not candidate:
        return None
    try:
        data = json.loads(candidate)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def interpret_free_text(text: str, today_str: str, log_fn=print) -> Optional[str]:
    """Переводит свободный текст в каноническую команду.

    Возвращает строку канонической команды или None
    (LLM недоступен / не понял / нет конфига).
    """
    cfg = load_kimi_config()
    if not cfg:
        log_fn("⚠️ kimi.json не настроен, LLM-режим недоступен")
        return None

    # requests импортируем лениво, чтобы модуль можно было тестировать без сети
    try:
        import requests
    except ImportError:
        log_fn("⚠️ requests не установлен, LLM-режим недоступен")
        return None

    base_url = cfg.get('base_url', 'https://api.moonshot.ai/v1').rstrip('/')
    payload = {
        "model": cfg.get('model', 'moonshot-v1-8k'),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT.format(today=today_str)},
            {"role": "user", "content": text},
        ],
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
    }
    try:
        resp = requests.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {cfg['api_key']}",
                     "Content-Type": "application/json"},
            json=payload,
            timeout=TIMEOUT,
        )
        if resp.status_code != 200:
            log_fn(f"⚠️ Kimi API вернул {resp.status_code}: {resp.text[:150]}")
            return None
        content = (resp.json().get('choices') or [{}])[0] \
                          .get('message', {}).get('content', '')
    except Exception as e:
        log_fn(f"⚠️ Ошибка вызова Kimi API: {e}")
        return None

    data = extract_json(content)
    if not data:
        log_fn(f"⚠️ Kimi вернул не-JSON: {content[:150]}")
        return None
    command_text = data.get('command_text')
    if not command_text or not isinstance(command_text, str):
        return None
    return command_text.strip()
