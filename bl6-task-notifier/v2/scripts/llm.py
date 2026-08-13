#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LLM-режим свободной формы (BL-6, v3.0) — админы/суперадмин, только личка.

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
MAX_TOKENS = 1000
TEMPERATURE = 0.1

SYSTEM_PROMPT = """Ты — транслятор просьб в команды Telegram-бота реестра поручений.

Сегодняшняя дата: {today} (используй для относительных дат).

Доступные реестры:
{registries}

Переведи просьбу пользователя в ОДНУ каноническую команду бота.
Допустимые команды (строго в этих форматах):
- создать поручение: Проект=<проект>; Описание=<описание>; Ответственный=<имя>; Срок=<дата>
- закрыть #N
- срок #N <дата>          (дата ДД.ММ.ГГГГ или «завтра», «в пятницу»)
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
- переключить реестр на <название реестра>

Ответь СТРОГО одним JSON-объектом без пояснений и markdown:
{{"command_text": "<каноническая команда>"}}
или, если просьбу нельзя свести к команде:
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


def interpret_free_text(text: str, today_str: str, cfg: dict, log_fn=print) -> Optional[str]:
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
    payload = {
        "model": cfg_kimi.get('model', 'moonshot-v1-8k'),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT.format(today=today_str, registries=registries_text)},
            {"role": "user", "content": text},
        ],
        "temperature": TEMPERATURE,
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


CHAT_PROMPT = """Ты — ассистент Telegram-бота «Task notifier» (@Plaxotin_task_bot).
Ты помогаешь суперадминистратору управлять ботом и реестром поручений.

Текущая конфигурация бота:
- Версия: v3.0
- Реестры: {registries}
- Активный реестр: {active_registry}
- Суперадмин: {superadmin}
- Администраторы: {admins}
- Лимиты: {limits}
- Время дайджеста: {digest_time}
- Владелец: {owner_email}

Возможности бота:
• Автоматическая рассылка дайджеста в группу Telegram каждый день в указанное время
• Управление реестром поручений через Google Sheets
• Inline-кнопки для обычных пользователей
• LLM-режим свободной формы для администраторов
• Аудит-лог всех изменений
• Переключение между несколькими реестрами

Отвечай кратко, по существу, на русском языке. Если не знаешь ответ — честно скажи.
"""


def chat_response(user_text: str, cfg: dict, log_fn=print) -> str:
    """Свободный диалог с LLM (для суперадмина). Возвращает текст ответа или пустую строку."""
    cfg_kimi = load_kimi_config()
    if not cfg_kimi:
        log_fn("⚠️ kimi.json не настроен, чат недоступен")
        return ""
    try:
        import requests
    except ImportError:
        log_fn("⚠️ requests не установлен, чат недоступен")
        return ""

    base_url = cfg_kimi.get('base_url', 'https://api.moonshot.ai/v1').rstrip('/')
    model = cfg_kimi.get('model', 'moonshot-v1-8k')

    active = None
    for r in cfg.get('registries', []):
        if r.get('active'):
            active = r.get('name', 'Неизвестно')
            break
    if not active:
        active = cfg.get('spreadsheet_id', 'Неизвестно')

    reg_list = "\n".join(
        f"- {r.get('name', 'Без названия')}{' (активный)' if r.get('active') else ''}"
        for r in cfg.get('registries', [])
    ) or "- Один реестр (старая схема)"

    system_msg = CHAT_PROMPT.format(
        registries=reg_list,
        active_registry=active,
        superadmin=cfg.get('superadmin', 'plaxotin'),
        admins=", ".join(str(a) for a in cfg.get('admins', [])),
        limits=str(cfg.get('limits', {})),
        digest_time=cfg.get('digest_time', '20:47'),
        owner_email=cfg.get('owner_email', '—'),
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_text},
        ],
        "temperature": 0.3,
        "max_tokens": 2000,
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
            return ""
        data = resp.json()
        content = data.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
        return content
    except Exception as e:
        log_fn(f"⚠️ Ошибка чата с Kimi: {e}")
        return ""
