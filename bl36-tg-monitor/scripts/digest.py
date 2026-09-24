#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BL-36: ежедневный дайджест новостей проекта (SPEC-BL-36 §6.5).

Контент: сигналы news за 24 ч + подтверждённые записи (поручения/решения/риски)
за 24 ч, со ссылками на источники. Текст собирает LLM (kimi-k2.6, thinking
вкл — паттерн совета дайджеста BL-6). Удаление предыдущего дайджеста —
.credentials/last_digest.json ({chat_id: [message_ids]}), как в BL-6.

Плановая отправка: digest_time_msk (дефолт 09:17 МСК), если за сутки нет
ни сигналов, ни записей — дайджест не шлём. Ручной вызов: /digest.
Переключатель авто-режима: /digest_auto (флаг digest_auto в config.json).
"""

import datetime as dt
import json
import os
import time

import requests

import config
import db
import tg

MSK = dt.timezone(dt.timedelta(hours=3))
MAX_TOKENS = 8000
TIMEOUT = 120

SYSTEM_PROMPT = """Ты — редактор проектного дайджеста. По данным за сутки собери короткий дайджест для руководителя проекта.

Формат (Markdown-разметка НЕ нужна, обычный текст с эмодзи):
📰 Дайджест проекта · <дата>

📰 Новости — по пункту на новость, со ссылкой на источник
📌 Новые поручения — «что сделать — кто — срок»
🤝 Решения — по пункту
⚠️ Риски — по пункту

Правила:
- Только факты из данных, ничего не выдумывай и не додумывай.
- Пустые разделы пропускай.
- Ссылки сохраняй как есть (https://t.me/...).
- Максимум 1200 символов. Пиши по-русски, сухо и по делу."""


def _call_kimi(user_content: str):
    cfg = config.load_kimi_config()
    if not cfg:
        return None
    base_url = cfg.get('base_url', 'https://api.moonshot.ai/v1').rstrip('/')
    payload = {
        'model': cfg.get('model', 'kimi-k2.6'),
        'messages': [{'role': 'system', 'content': SYSTEM_PROMPT},
                     {'role': 'user', 'content': user_content}],
        'max_tokens': MAX_TOKENS,
    }
    for attempt in range(6):
        try:
            resp = requests.post('%s/chat/completions' % base_url,
                                 headers={'Authorization': 'Bearer %s' % cfg['api_key'],
                                          'Content-Type': 'application/json'},
                                 json=payload, timeout=TIMEOUT)
            if resp.status_code != 200:
                print('digest Kimi %s: %s' % (resp.status_code, resp.text[:200]),
                      flush=True)
                time.sleep(min(60, 15 * (attempt + 1))
                           if resp.status_code == 429 else 2 ** attempt)
                continue
            content = (resp.json().get('choices') or [{}])[0] \
                      .get('message', {}).get('content', '') or ''
            if content.strip():
                return content.strip()
        except Exception as e:
            print('digest Kimi exc: %s' % e, flush=True)
            time.sleep(2 ** attempt)
    return None


def collect_day():
    """Данные за последние 24 ч: news-сигналы + подтверждённые предложения."""
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)) \
        .isoformat()
    news = db.select('bl36_signals', {
        'type': 'eq.news', 'created_at': 'gte.%s' % since,
        'select': 'summary,rationale,msg_ids,created_at',
        'order': 'created_at'})
    confirmed = db.select('bl36_proposals', {
        'status': 'in.(confirmed,edited_confirmed)',
        'decided_at': 'gte.%s' % since,
        'select': 'target,payload,decided_at', 'order': 'decided_at'})
    return news, confirmed


def _fmt_data(news, confirmed):
    parts = ['НОВОСТИ (сигналы из чатов):']
    if news:
        for s in news:
            parts.append('- %s' % s['summary'])
    else:
        parts.append('(нет)')
    parts.append('\nПОДТВЕРЖДЁННЫЕ ЗАПИСИ:')
    if confirmed:
        for pr in confirmed:
            p = pr.get('payload') or {}
            links = [l for l in (p.get('source_links') or []) if l]
            parts.append('- [%s] %s%s%s' % (
                pr['target'], p.get('text') or '',
                ' — %s' % p['assignee'] if p.get('assignee') else '',
                ' | %s' % links[0] if links else ''))
    else:
        parts.append('(нет)')
    return '\n'.join(parts)


def _last_digest_path():
    return os.path.join(config.CREDS_DIR, 'last_digest.json')


def _delete_previous(chat_id):
    try:
        with open(_last_digest_path(), encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return
    for mid in data.get(str(chat_id), []):
        tg.tg_call('deleteMessage', chat_id=chat_id, message_id=mid)


def _save_digest(chat_id, message_id):
    data = {}
    try:
        with open(_last_digest_path(), encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        pass
    data[str(chat_id)] = [message_id]
    with open(_last_digest_path(), 'w', encoding='utf-8') as f:
        json.dump(data, f)


def send_digest(chat_id, force=False):
    """Собрать и отправить дайджест. force=False: пропуск при пустых данных."""
    news, confirmed = collect_day()
    if not force and not news and not confirmed:
        print('digest: данных за сутки нет, пропуск', flush=True)
        return False
    text = _call_kimi(_fmt_data(news, confirmed))
    if not text:
        today = dt.datetime.now(MSK).strftime('%d.%m.%Y')
        text = '📰 Дайджест проекта · %s\n\n' % today + _fmt_data(news, confirmed)
    _delete_previous(chat_id)
    res = tg.send_message(chat_id, text)
    if res:
        _save_digest(chat_id, res['message_id'])
    return bool(res)


def digest_loop(get_cfg, get_chat_id):
    """Планировщик: раз в минуту проверяем наступление digest_time_msk."""
    last_fired = None
    while True:
        time.sleep(60)
        try:
            cfg = get_cfg()
            if not cfg.get('digest_auto', True):
                continue
            hh, mm = (cfg.get('digest_time_msk') or '09:17').split(':')
            now = dt.datetime.now(MSK)
            chat_id = get_chat_id()
            if not chat_id:
                continue
            if (now.hour, now.minute) >= (int(hh), int(mm)):
                today = now.strftime('%Y-%m-%d')
                if last_fired != today:
                    last_fired = today
                    print('digest: плановая отправка %s' % today, flush=True)
                    send_digest(chat_id)
        except Exception as e:
            print('digest loop error: %s' % e, flush=True)
