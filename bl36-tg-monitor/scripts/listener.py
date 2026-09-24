#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BL-36 listener (@PMO_vision_bot): сбор сообщений из TG-чатов проекта.

Фаза 0/1 (SPEC-BL-36 §12): Bot API long-poll, авто-регистрация чата при
добавлении бота админом, фильтр шума, запись в bl36_messages (Supabase),
команды /start, /status, /usage (заглушка до фазы 2).

Утверждать предложения может только РП (owner_id/admin_ids из telegram.json).
"""

import datetime as dt
import threading
import time

import requests

import config
import db

API = 'https://api.telegram.org/bot%s'
MIN_CHARS = 25           # как MIN_MATERIAL_CHARS в BL-28; короткое без reply = шум
POLL_TIMEOUT = 30

_tg = None
_cfg = None
_session = requests.Session()
_offset = 0
_offset_lock = threading.Lock()


# ---------- Telegram API ----------

def tg_call(method, **params):
    url = API % _tg['bot_token'] + '/' + method
    for attempt in range(3):
        try:
            r = _session.post(url, json=params, timeout=POLL_TIMEOUT + 10)
            if r.status_code == 400 and 'migrate_to_chat_id' in r.text:
                new_id = r.json()['parameters']['migrate_to_chat_id']
                print('chat migrated -> %s' % new_id, flush=True)
                params['chat_id'] = new_id
                continue
            data = r.json()
            if data.get('ok'):
                return data['result']
            print('tg %s error: %s' % (method, str(data)[:200]), flush=True)
            return None
        except Exception as e:
            print('tg %s exc (%d): %s' % (method, attempt, e), flush=True)
            time.sleep(2 * (attempt + 1))
    return None


def send_message(chat_id, text, reply_markup=None):
    params = {'chat_id': chat_id, 'text': text}
    if reply_markup:
        params['reply_markup'] = reply_markup
    return tg_call('sendMessage', **params)


def is_admin(user_id):
    ids = set(_tg.get('admin_ids') or [])
    owner = _tg.get('owner_id')
    if owner:
        ids.add(owner)
    return user_id in ids


# ---------- Ссылки на сообщения ----------

def message_link(chat_id, msg_id):
    """https://t.me/c/<chat>/<msg> для супергрупп (SPEC-BL-36 §3)."""
    cid = str(chat_id)
    if cid.startswith('-100'):
        return 'https://t.me/c/%s/%s' % (cid[4:], msg_id)
    return None  # обычные группы/личка — публичной ссылки нет


# ---------- Фильтр шума (SPEC-BL-36 §6.2) ----------

def is_noise(msg):
    text = (msg.get('text') or msg.get('caption') or '').strip()
    if msg.get('from', {}).get('is_bot'):
        return True
    if not text:  # стикеры, фото без подписи, служебные события
        return True
    if len(text) < _cfg['min_message_chars'] and not msg.get('reply_to_message'):
        return True
    # эмодзи-only
    if not any(ch.isalnum() for ch in text):
        return True
    return False


# ---------- Каналы ----------

def register_channel(chat, added_by):
    row = {
        'chat_id': chat['id'],
        'title': chat.get('title'),
        'project_id': _cfg['project_id'],
        'is_active': True,
        'connected_by': added_by,
    }
    saved = db.upsert('bl36_channels', row, on_conflict='chat_id')
    print('channel registered: %s (%s)' % (chat.get('title'), chat['id']),
          flush=True)
    return saved


def deactivate_channel(chat_id):
    db.update('bl36_channels', {'chat_id': 'eq.%s' % chat_id},
              {'is_active': False})
    print('channel deactivated: %s' % chat_id, flush=True)


def known_channel(chat_id):
    rows = db.select('bl36_channels',
                     {'chat_id': 'eq.%s' % chat_id, 'is_active': 'eq.true',
                      'select': 'id,title'})
    return rows[0] if rows else None


# ---------- Обработчики ----------

def handle_my_chat_member(upd):
    """Бота добавили/удалили/повысили в чате."""
    m = upd.get('my_chat_member') or {}
    chat = m.get('chat') or {}
    if chat.get('type') not in ('group', 'supergroup'):
        return
    new = (m.get('new_chat_member') or {}).get('status')
    by = (m.get('from') or {}).get('id')
    if new == 'administrator':
        register_channel(chat, by)
        send_message(chat['id'],
                     '📡 @PMO_vision_bot подключён: чат «%s» под наблюдением. '
                     'Сообщения анализируются, решения и поручения предлагаются '
                     'РП на подтверждение.' % (chat.get('title') or ''))
        owner = _tg.get('owner_id')
        if owner:
            send_message(owner, '✅ Чат подключён: «%s» (%s)' %
                         (chat.get('title'), chat['id']))
    elif new in ('left', 'kicked', 'member'):
        # member без прав админа — privacy mode, сообщений не видим
        if new == 'member':
            send_message(chat['id'],
                         '⚠️ Для наблюдения за чатом нужны права администратора '
                         '(иначе Telegram не показывает боту сообщения).')
        else:
            deactivate_channel(chat['id'])


def handle_message(msg):
    chat = msg.get('chat') or {}
    chat_id = chat.get('id')
    user = msg.get('from') or {}
    text = (msg.get('text') or '').strip()

    # команды — в личке и в чатах, только для админов/РП
    if text.startswith('/'):
        if is_admin(user.get('id')):
            handle_command(chat_id, text.split('@')[0].lower())
        return

    # обычные сообщения — только из подключённых групп
    if chat.get('type') not in ('group', 'supergroup'):
        return
    if not known_channel(chat_id):
        return

    noise = is_noise(msg)
    body = (msg.get('text') or msg.get('caption') or '').strip()
    row = {
        'chat_id': chat_id,
        'msg_id': msg['message_id'],
        'author_id': user.get('id'),
        'author_login': user.get('username'),
        'author_name': ' '.join(filter(None, [user.get('first_name'),
                                              user.get('last_name')])) or None,
        'text': body or None,
        'reply_to_msg_id': (msg.get('reply_to_message') or {}).get('message_id'),
        'sent_at': dt.datetime.fromtimestamp(
            msg['date'], tz=dt.timezone.utc).isoformat(),
        'link': message_link(chat_id, msg['message_id']),
        'is_noise': noise,
    }
    db.upsert('bl36_messages', row, on_conflict='chat_id,msg_id')


def handle_command(chat_id, cmd):
    if cmd == '/start':
        send_message(chat_id,
                     '📡 PMO Vision (BL-36): наблюдаю за чатами проекта, '
                     'выделяю поручения, решения и риски, предлагаю РП на '
                     'подтверждение.\n\n'
                     '/status — подключённые чаты и счётчики\n'
                     '/usage — расход LLM (после фазы 2)')
    elif cmd == '/status':
        cmd_status(chat_id)
    elif cmd == '/usage':
        send_message(chat_id, 'LLM-учёт появится в фазе 2 (sense-making).')


def cmd_status(chat_id):
    channels = db.select('bl36_channels',
                         {'is_active': 'eq.true',
                          'select': 'chat_id,title,connected_at'})
    pending = db.count_pending_proposals()
    lines = ['📡 Статус PMO Vision', '']
    if not channels:
        lines.append('Подключённых чатов нет. Добавьте бота в чат и выдайте '
                     'права администратора.')
    for ch in channels:
        cnt = db.select('bl36_messages',
                        {'chat_id': 'eq.%s' % ch['chat_id'], 'select': 'id'})
        noise = db.select('bl36_messages',
                          {'chat_id': 'eq.%s' % ch['chat_id'],
                           'is_noise': 'eq.true', 'select': 'id'})
        lines.append('• %s (%s)\n  сообщений: %d, шум: %d' %
                     (ch.get('title') or 'чат', ch['chat_id'],
                      len(cnt), len(noise)))
    lines.append('')
    lines.append('📥 Предложений ожидает решения: %d' % pending)
    send_message(chat_id, '\n'.join(lines))


# ---------- Главный цикл ----------

def dispatch(upd):
    try:
        if 'my_chat_member' in upd:
            handle_my_chat_member(upd)
        elif 'message' in upd:
            handle_message(upd['message'])
    except Exception as e:
        print('dispatch error: %s' % e, flush=True)


def main():
    global _tg, _cfg
    _tg = config.load_telegram_config()
    if not _tg:
        raise SystemExit('telegram.json не найден (.credentials/)')
    _cfg = config.load_config()
    print('BL-36 listener started, project=%s' % _cfg['project_id'], flush=True)

    global _offset
    while True:
        try:
            res = tg_call('getUpdates', offset=_offset, timeout=POLL_TIMEOUT,
                          allowed_updates=['message', 'my_chat_member'])
            if res:
                for upd in res:
                    with _offset_lock:
                        _offset = upd['update_id'] + 1
                    threading.Thread(target=dispatch, args=(upd,),
                                     daemon=True).start()
        except Exception as e:
            print('poll error: %s' % e, flush=True)
            time.sleep(5)


if __name__ == '__main__':
    main()
