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

Переведи просьбу пользователя в ОДНУ ИЛИ НЕСКОЛЬКО канонических команд бота
(если в просьбе несколько действий — верни несколько команд, по одной на действие).
Допустимые команды (строго в этих форматах):
- создать поручение: Контрагент=<контрагент>; Описание=<описание>; Ответственный=<имя>; Срок=<дата>; Приоритет=<0-3>
- закрыть #N
- срок #N <дата>          (дата ДД.ММ.ГГГГ или «завтра», «в пятницу»)
- статус #N <статус>      (статусы: В работе, На проверке, Выполнено, Отменено)
- ответственный #N <имя>
- описание #N <текст>
- комментарий #N <текст>
- приоритет #N <0-3>
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
  - Контрагент = компания ответственного (НЕ название реестра!); если компания неизвестна — укажи «?» (бот подставит её сам из вкладки «Контакты»)
  - Ответственный = имя пользователя (см. выше)
  - Срок = завтра
  - Описание = краткая суть запроса
• Если пользователь говорит "тестовое поручение" — используй описание "Тестовое поручение", контрагент = «?», ответственный = пользователь, срок = завтра.
• Слова «мне», «для меня», «моё» — Ответственный = имя пользователя (см. выше: {username}).
• Приоритет: шкала 0–3, где 0 — критичный (срочно/блокер/горит), 1 — высокий, 2 — средний, 3 — низкий.
  Если пользователь явно не указал важность — ставь Приоритет=2. Слова «срочно», «критично», «asap», «горит» → 0–1; «не горит», «когда-нибудь», «по возможности» → 3.
  Поле Приоритет в команде «создать поручение» указывай ВСЕГДА.

ВАЖНО:
• Если пользователь задаёт ВОПРОС (содержит '?' или слова 'как', 'что', 'почему', 'какие', 'сколько', 'где', 'когда', 'кто'), а не просит выполнить действие — верни {{"commands": []}}.
• Если просьба не подходит ни под одну команду выше — верни {{"commands": []}}.
• Отвечай СТРОГО одним JSON-объектом без пояснений и markdown.

Формат ответа:
{{"commands": ["<каноническая команда 1>", "<каноническая команда 2>"]}}
или (если действий нет):
{{"commands": []}}"""


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


def interpret_free_text(text: str, today_str: str, cfg: dict, username: str = "", log_fn=print) -> Optional[list]:
    """Переводит свободный текст в список канонических команд.

    Возвращает list[str] (1+ команд) или None, если интерпретировать не удалось.
    """
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
        # temperature не передаём: kimi-k2.x принимает только temperature=1.
        # Перевод в команду — задача простая, reasoning отключаем:
        # быстрее (секунды вместо 40+), дешевле, и reasoning не съест max_tokens.
        "thinking": {"type": "disabled"},
        "max_tokens": MAX_TOKENS,
    }

    content = ""
    for attempt in range(2):
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
                              .get('message', {}).get('content', '') or ''
        except Exception as e:
            log_fn(f"⚠️ Ошибка вызова Kimi API: {e}")
            return None
        if content.strip():
            break
        # Пустой ответ с отключённым reasoning — разовый сбой модели.
        # Повторяем один раз с включённым thinking.
        log_fn("⚠️ Kimi вернул пустой ответ, повторяю с thinking")
        payload.pop("thinking", None)

    data = extract_json(content)
    if not data:
        log_fn(f"⚠️ Kimi вернул не-JSON: {content[:150]}")
        return None
    # Новый формат: {"commands": [...]}. Старый (обратная совместимость): {"command_text": "..."}.
    cmds = data.get('commands')
    if cmds is None:
        single = data.get('command_text')
        cmds = [single] if isinstance(single, str) and single.strip() else []
    if not isinstance(cmds, list):
        return None
    result = [c.strip() for c in cmds if isinstance(c, str) and c.strip()]
    return result or None


def call_kimi_json(system_prompt: str, user_text: str, log_fn=print,
                   max_tokens: int = 2000) -> Optional[dict]:
    """Универсальный вызов Kimi с JSON-ответом (для семантических проверок:
    дубли и т.п.). Возвращает dict или None при любой ошибке."""
    cfg_kimi = load_kimi_config()
    if not cfg_kimi:
        log_fn("⚠️ kimi.json не настроен, LLM-проверка недоступна")
        return None
    try:
        import requests
    except ImportError:
        log_fn("⚠️ requests не установлен, LLM-проверка недоступна")
        return None

    base_url = cfg_kimi.get('base_url', 'https://api.moonshot.ai/v1').rstrip('/')
    payload = {
        "model": cfg_kimi.get('model', 'kimi-k2.6'),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        # temperature не передаём: kimi-k2.x принимает только temperature=1.
        "thinking": {"type": "disabled"},
        "max_tokens": max_tokens,
    }

    content = ""
    for attempt in range(2):
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
                              .get('message', {}).get('content', '') or ''
        except Exception as e:
            log_fn(f"⚠️ Ошибка вызова Kimi API: {e}")
            return None
        if content.strip():
            break
        log_fn("⚠️ Kimi вернул пустой ответ, повторяю с thinking")
        payload.pop("thinking", None)

    return extract_json(content)


DUP_CHECK_SYSTEM = """Ты — помощник PMO. Проверяешь новое поручение на дубли среди открытых.

Дубликат — это поручение о ТОМ ЖЕ деле, даже если сформулировано другими словами
(перефразировка, другой порядок слов, чуть другой объём). НЕ дубликаты: задачи
про разные объекты/этапы/артефакты, общие темы без совпадения сути.

Отвечай СТРОГО одним JSON-объектом без пояснений и markdown:
{"duplicates": [<id поручений-дублей через запятую>]}
Если дублей нет: {"duplicates": []}"""


DUP_AUDIT_SYSTEM = """Ты — помощник PMO. Ищешь пары поручений-дублей в списке открытых поручений.

Дубликаты — поручения об ОДНОМ И ТОМ ЖЕ деле, даже если сформулированы по-разному.
НЕ дубликаты: разные объекты/этапы/артефакты, просто похожие темы.

Отвечай СТРОГО одним JSON-объектом без пояснений и markdown:
{"pairs": [[<id1>, <id2>], ...]}
Если дублей нет: {"pairs": []}"""
