#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LLM-режим свободной формы (BL-6, v3.0) — админы, только личка.

Переводит свободную просьбу в КАНОНИЧЕСКУЮ текстовую команду бота.
Дальше канонический текст проходит обычный путь: parse → подтверждение «да» → dispatch.

Конфиг: .credentials/kimi.json
"""

import json
import os
import re
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CREDS_DIR = os.path.join(SCRIPT_DIR, '..', '.credentials')
KIMI_CONFIG = os.path.join(CREDS_DIR, 'kimi.json')

TIMEOUT = 60
# kimi-k2.x — «думающие» модели: reasoning тоже расходует max_tokens,
# поэтому запас должен покрывать и размышления, и ответ.
MAX_TOKENS = 4000

SYSTEM_PROMPT = """Ты — транслятор просьб в команды Telegram-бота реестра поручений.

Сегодняшняя дата: {today} (используй для относительных дат).

Доступные реестры:
{registries}

Активный реестр: {active_registry}
Пользователь: {username}

Переведи просьбу пользователя в ОДНУ каноническую команду бота.
Допустимые команды (строго в этих форматах):
- создать поручение: Контрагент=<контрагент>; Описание=<описание>; Ответственный=<имя>; Срок=<дата>
- закрыть #N
- срок #N <дата>          (дата ДД.ММ.ГГГГ или «завтра», «в пятницу»)
- статус #N <статус>      (статусы: Новое, В работе, На проверке, Выполнено, Отменено)
- ответственный #N <имя>
- описание #N <текст>
- комментарий #N <текст>
- удалить #N
- мои поручения
- все поручения
- поручения <контрагент>
- поручения статус <статус>
- дайджест
- реестр
- новый реестр <название>
- подключить реестр <название> <ссылка на Google Sheet>
- переключить реестр на <название реестра>

ПРАВИЛА ДЛЯ СОЗДАНИЯ ПОРУЧЕНИЯ:
• Если пользователь просит создать поручение, но не указывает все поля — используй УМОЛЧАНИЯ:
  - Контрагент = активный реестр (см. выше)
  - Ответственный = имя пользователя (см. выше)
  - Срок = завтра
  - Описание = краткая суть запроса
• Если пользователь говорит "тестовое поручение" — используй описание "Тестовое поручение", контрагент = активный реестр, ответственный = пользователь, срок = завтра.

ВАЖНО:
• Если пользователь задаёт ВОПРОС (содержит '?' или слова 'как', 'что', 'почему', 'какие', 'сколько', 'где', 'когда', 'кто'), а не просит выполнить действие — верни {{"command_text": null}}.
• Если просьба не подходит ни под одну команду выше — верни {{"command_text": null}}.
• Отвечай СТРОГО одним JSON-объектом без пояснений и markdown.

Формат ответа:
{{"command_text": "<каноническая команда>"}}
или:
{{"command_text": null}}"""


def load_kimi_config() -> Optional[dict]:
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
    if not text:
        return None
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


def _format_registries(cfg: dict) -> str:
    regs = cfg.get('registries', [])
    if not regs:
        active_id = cfg.get('spreadsheet_id', '')
        return f"- Активный реестр: {active_id}"
    lines = []
    for r in regs:
        mark = " (активный)" if r.get('active') else ""
        lines.append(f"- {r.get('name', 'Без названия')}{mark}")
    return "\n".join(lines)


def interpret_free_text(text: str, today_str: str, cfg: dict, username: str = "", log_fn=print) -> Optional[str]:
    cfg_kimi = load_kimi_config()
    if not cfg_kimi:
        log_fn("⚠️ kimi.json не настроен, LLM-режим недоступен")
        return None
    try:
        import requests
    except ImportError:
        log_fn("⚠️ requests не установлен, LLM-режим недоступен")
        return None

    base_url = cfg_kimi.get('base_url', 'https://api.moonshot.ai/v1').rstrip('/')
    registries_text = _format_registries(cfg)
    active_registry = cfg.get('registries', [{'name': cfg.get('spreadsheet_id', 'Реестр')}])[0].get('name', 'Реестр')
    for r in cfg.get('registries', []):
        if r.get('active'):
            active_registry = r.get('name', 'Реестр')
            break
    payload = {
        "model": cfg_kimi.get('model', 'kimi-k2.6'),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT.format(today=today_str, registries=registries_text, active_registry=active_registry, username=username)},
            {"role": "user", "content": text},
        ],
        # temperature не передаём: kimi-k2.x принимает только temperature=1
        "max_tokens": MAX_TOKENS,
    }
    try:
        resp = requests.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {cfg_kimi['api_key']}",
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
