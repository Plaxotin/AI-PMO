#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BL-36 sense-making: батч сообщений → LLM kimi-k2.6 → сигналы → предложения.

SPEC-BL-36 §6.3: каждые 30 мин по каждому активному чату забираем
необработанные нешумовые сообщения, LLM возвращает JSON сигналов,
сигнал без источника отбрасывается, confidence < порога — не предлагаем.
Сигналы типа news идут только в дайджест (предложение не создаётся).
"""

import datetime as dt
import json
import os
import time
import uuid

import requests

import config
import db

MAX_TOKENS = 8000
TIMEOUT = 120

SYSTEM_PROMPT = """Ты — аналитик проектного офиса. Тебе дают фрагмент переписки рабочего чата проекта в Telegram.

Выдели из переписки СИГНАЛЫ — факты, важные для управления проектом:
- assignment — поручение/просьба с адресатом (кто-то должен что-то сделать);
- decision — решение или договорённость («договорились», «решили», «делаем так»);
- risk — риск, проблема, опасение (угроза срокам/бюджету/качеству);
- news — новость проекта, важная для дайджеста (статус, событие, факт).

Правила:
1. Только то, что ЯВНО следует из сообщений. Ничего не выдумывай.
2. Каждый сигнал обязан ссылаться на id сообщений-источников (quote_msg_ids).
3. Шум (приветствия, эмодзи, болтовня) игнорируй.
4. confidence: 0.9+ — прямое поручение/решение; 0.5–0.8 — вероятный сигнал; < 0.5 не выдавай.
5. Если сигналов нет — верни пустой массив.

Ответ — СТРОГО JSON-массив без пояснений и markdown-обёртки:
[{"type": "assignment|decision|risk|news",
  "summary": "суть одной фразой (для поручения: что сделать)",
  "assignee": "ФИО/имя адресата или null",
  "due": "срок текстом как в сообщении или null",
  "rationale": "почему это сигнал и какой эффект для проекта",
  "quote_msg_ids": [123],
  "confidence": 0.9}]"""

TYPE_TARGET = {'assignment': 'assignment', 'decision': 'decision',
               'risk': 'risk'}


def _usage_log(usage: dict, batch_id: str):
    """Учёт токенов — outputs/_usage.jsonl (паттерн BL-28)."""
    try:
        out_dir = os.path.join(config.SCRIPT_DIR, '..', 'outputs')
        os.makedirs(out_dir, exist_ok=True)
        rec = {'ts': dt.datetime.now(dt.timezone.utc).isoformat(),
               'batch': batch_id, **usage}
        with open(os.path.join(out_dir, '_usage.jsonl'), 'a',
                  encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    except Exception as e:
        print('usage log error: %s' % e, flush=True)


def _call_kimi(user_content: str) -> tuple:
    """Один вызов Kimi с retry/backoff (паттерн BL-1). Возвращает (текст, usage)."""
    cfg = config.load_kimi_config()
    if not cfg:
        print('⚠️ kimi.json не настроен', flush=True)
        return None, {}
    base_url = cfg.get('base_url', 'https://api.moonshot.ai/v1').rstrip('/')
    payload = {
        'model': cfg.get('model', 'kimi-k2.6'),
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': user_content},
        ],
        # temperature не передаём: kimi-k2.x принимает только temperature=1.
        'max_tokens': MAX_TOKENS,
    }
    for attempt in range(6):
        try:
            resp = requests.post(
                '%s/chat/completions' % base_url,
                headers={'Authorization': 'Bearer %s' % cfg['api_key'],
                         'Content-Type': 'application/json'},
                json=payload, timeout=TIMEOUT)
            if resp.status_code != 200:
                print('Kimi %s: %s' % (resp.status_code, resp.text[:200]),
                      flush=True)
                time.sleep(min(60, 15 * (attempt + 1))
                           if resp.status_code == 429 else 2 ** attempt)
                continue
            data = resp.json()
            content = (data.get('choices') or [{}])[0] \
                      .get('message', {}).get('content', '') or ''
            if content.strip():
                return content.strip(), data.get('usage') or {}
            print('⚠️ Kimi вернул пустой ответ, повторяю', flush=True)
        except Exception as e:
            print('⚠️ Ошибка Kimi API: %s' % e, flush=True)
            time.sleep(2 ** attempt)
    return None, {}


def _parse_signals(text: str):
    """Достаём JSON-массив из ответа (терпим обёртку ```json ... ```)."""
    t = text.strip()
    if t.startswith('```'):
        t = t.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
    try:
        data = json.loads(t)
        return data if isinstance(data, list) else []
    except Exception:
        # попытка вырезать массив из текста
        a, b = t.find('['), t.rfind(']')
        if a >= 0 and b > a:
            try:
                data = json.loads(t[a:b + 1])
                return data if isinstance(data, list) else []
            except Exception:
                pass
    return []


def _fmt_messages(messages):
    lines = []
    for m in messages:
        ts = (m.get('sent_at') or '')[:16].replace('T', ' ')
        author = m.get('author_name') or m.get('author_login') or '?'
        lines.append('[msg %s | %s | %s] %s' %
                     (m['msg_id'], ts, author, (m.get('text') or '').strip()))
    return '\n'.join(lines)


def run_batch(send_proposal_fn, log_fn=print):
    """Один прогон по всем активным чатам.

    send_proposal_fn(proposal_row, signal_row) — отправка карточки РП.
    """
    cfg = config.load_config()
    threshold = float(cfg['confidence_threshold'])
    channels = db.select('bl36_channels', {'is_active': 'eq.true',
                                           'select': 'id,chat_id,title'})
    for ch in channels:
        msgs = db.select('bl36_messages', {
            'chat_id': 'eq.%s' % ch['chat_id'],
            'is_noise': 'eq.false',
            'processed_at': 'is.null',
            'select': 'msg_id,author_name,author_login,text,sent_at,link',
            'order': 'sent_at',
            'limit': '500',
        })
        if not msgs:
            continue
        batch_id = str(uuid.uuid4())
        log_fn('sense: чат %s, сообщений %d' % (ch['chat_id'], len(msgs)))
        text, usage = _call_kimi(_fmt_messages(msgs))
        _usage_log(usage, batch_id)
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        # помечаем сообщения обработанными в любом случае (иначе ретрай-шторм)
        for m in msgs:
            db.update('bl36_messages',
                      {'chat_id': 'eq.%s' % ch['chat_id'],
                       'msg_id': 'eq.%s' % m['msg_id']},
                      {'processed_at': now})
        if not text:
            continue
        valid_ids = {m['msg_id'] for m in msgs}
        link_by_id = {m['msg_id']: m.get('link') for m in msgs}
        n_prop = 0
        for s in _parse_signals(text):
            stype = s.get('type')
            quote = [q for q in (s.get('quote_msg_ids') or [])
                     if q in valid_ids]
            if stype not in ('assignment', 'decision', 'risk', 'news') \
                    or not s.get('summary') or not quote:
                continue  # сигнал без источника отбрасывается (SPEC §6.3)
            try:
                conf = float(s.get('confidence') or 0)
            except Exception:
                conf = 0
            signal_row = db.insert('bl36_signals', {
                'channel_id': ch['id'],
                'type': stype,
                'summary': s['summary'],
                'rationale': s.get('rationale'),
                'confidence': conf,
                'msg_ids': quote,
                'batch_id': batch_id,
            })
            if not signal_row:
                continue
            target = TYPE_TARGET.get(stype)
            if not target or conf < threshold:
                continue  # news — только в дайджест; ниже порога — не предлагаем
            proposal = db.insert('bl36_proposals', {
                'signal_id': signal_row['id'],
                'target': target,
                'action': 'create',
                'payload': {
                    'text': s['summary'],
                    'assignee': s.get('assignee'),
                    'due': s.get('due'),
                    'channel_title': ch.get('title'),
                    'source_links': [link_by_id[q] for q in quote
                                     if link_by_id.get(q)],
                },
            })
            if proposal:
                n_prop += 1
                try:
                    send_proposal_fn(proposal, signal_row)
                except Exception as e:
                    log_fn('send proposal error: %s' % e)
        log_fn('sense: чат %s — сигналов, предложений %d' %
               (ch['chat_id'], n_prop))
