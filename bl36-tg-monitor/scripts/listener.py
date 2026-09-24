#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BL-36 listener (@PMO_vision_bot): сбор сообщений из TG-чатов проекта.

Фазы 0/1/2 (SPEC-BL-36 §12): Bot API long-poll, авто-регистрация чата при
добавлении бота админом, фильтр шума, запись в bl36_messages (Supabase),
планировщик sense-making (каждые 30 мин, фоновый поток), карточки
предложений РП с кнопками ✓/✕/✎ (proposals.py).
Команды: /start, /status, /proposals, /usage.

Утверждать предложения может только РП (owner_id/admin_ids из telegram.json).
"""

import datetime as dt
import json
import os
import threading
import time

import config
import db
import digest
import proposals
import sense
import tg

_tg = None
_cfg = None
_offset = 0
_offset_lock = threading.Lock()
_sense_running = False  # защита от параллельных прогонов (паттерн _digest_running BL-6)


def is_admin(user_id):
    ids = set(_tg.get('admin_ids') or [])
    owner = _tg.get('owner_id')
    if owner:
        ids.add(owner)
    return user_id in ids


def admin_ids():
    ids = set(_tg.get('admin_ids') or [])
    if _tg.get('owner_id'):
        ids.add(_tg['owner_id'])
    return ids


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


# ---------- Sense-making (фоновый планировщик, SPEC §6.3) ----------

def _send_proposal(proposal_row, signal_row):
    owner = _tg.get('owner_id')
    if owner:
        proposals.send_proposal(owner, proposal_row, signal_row)


def run_sense(reason='schedule'):
    global _sense_running
    if _sense_running:
        print('sense: прогон уже идёт, пропуск (%s)' % reason, flush=True)
        return False
    _sense_running = True
    try:
        sense.run_batch(_send_proposal)
        return True
    except Exception as e:
        print('sense error: %s' % e, flush=True)
        return False
    finally:
        _sense_running = False


def sense_loop():
    interval = int(_cfg['sense_interval_sec'])
    while True:
        time.sleep(interval)
        threading.Thread(target=run_sense, args=('schedule',),
                         daemon=True).start()


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
        tg.send_message(chat['id'],
                        '📡 @PMO_vision_bot подключён: чат «%s» под '
                        'наблюдением. Сообщения анализируются, решения и '
                        'поручения предлагаются РП на подтверждение.'
                        % (chat.get('title') or ''))
        owner = _tg.get('owner_id')
        if owner:
            tg.send_message(owner, '✅ Чат подключён: «%s» (%s)' %
                            (chat.get('title'), chat['id']))
    elif new in ('left', 'kicked', 'member'):
        # member без прав админа — privacy mode, сообщений не видим
        if new == 'member':
            tg.send_message(chat['id'],
                            '⚠️ Для наблюдения за чатом нужны права '
                            'администратора (иначе Telegram не показывает '
                            'боту сообщения).')
        else:
            deactivate_channel(chat['id'])


def handle_message(msg):
    chat = msg.get('chat') or {}
    chat_id = chat.get('id')
    user = msg.get('from') or {}
    text = (msg.get('text') or '').strip()

    # режим правки предложения (личка с РП) — поглощает текст
    if chat.get('type') == 'private' and text and not text.startswith('/'):
        if proposals.handle_edit_input(msg, admin_ids()):
            return

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
        tg.send_message(chat_id,
                        '📡 PMO Vision (BL-36): наблюдаю за чатами проекта, '
                        'выделяю поручения, решения и риски, предлагаю РП на '
                        'подтверждение.\n\n'
                        '/status — подключённые чаты и счётчики\n'
                        '/proposals — переотправить ожидающие предложения\n'
                        '/sense — запустить анализ сейчас\n'
                        '/digest — дайджест сейчас\n'
                        '/digest_auto — вкл/выкл авто-дайджест\n'
                        '/usage — расход LLM')
    elif cmd == '/status':
        cmd_status(chat_id)
    elif cmd == '/digest':
        tg.send_message(chat_id, '⏳ Собираю дайджест…')
        threading.Thread(
            target=lambda: None if digest.send_digest(chat_id, force=True)
            else tg.send_message(chat_id, '⚠️ Дайджест не отправлен — см. лог.'),
            daemon=True).start()
    elif cmd == '/digest_auto':
        cfg = config.load_config()
        cfg['digest_auto'] = not cfg.get('digest_auto', True)
        config.save_config(cfg)
        tg.send_message(chat_id, '⏰ Авто-дайджест: %s' %
                        ('ВКЛ (ежедневно %s МСК)' % cfg['digest_time_msk']
                         if cfg['digest_auto'] else 'ВЫКЛ'))
    elif cmd == '/proposals':
        proposals.send_pending(_tg.get('owner_id') or chat_id)
    elif cmd == '/sense':
        tg.send_message(chat_id, '⏳ Запускаю анализ…')
        threading.Thread(
            target=lambda: tg.send_message(
                chat_id, '✅ Анализ завершён.' if run_sense('manual')
                else '⚠️ Анализ не выполнен — см. лог.'),
            daemon=True).start()
    elif cmd == '/usage':
        cmd_usage(chat_id)


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
    tg.send_message(chat_id, '\n'.join(lines))


def cmd_usage(chat_id):
    """Сводка расхода LLM из outputs/_usage.jsonl (паттерн BL-28)."""
    path = os.path.join(config.SCRIPT_DIR, '..', 'outputs', '_usage.jsonl')
    if not os.path.exists(path):
        tg.send_message(chat_id, 'Прогонов LLM пока не было.')
        return
    total_in = total_out = n = 0
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                n += 1
                total_in += rec.get('prompt_tokens') or 0
                total_out += rec.get('completion_tokens') or 0
    except Exception as e:
        tg.send_message(chat_id, 'Ошибка чтения usage: %s' % e)
        return
    # kimi-k2.6: $0.95/1M in, $4.00/1M out
    cost = total_in / 1e6 * 0.95 + total_out / 1e6 * 4.0
    tg.send_message(chat_id,
                    '📊 LLM-прогонов: %d\nТокены: %d in / %d out\n'
                    'Оценка стоимости: $%.4f' % (n, total_in, total_out, cost))


# ---------- Главный цикл ----------

def dispatch(upd):
    try:
        if 'my_chat_member' in upd:
            handle_my_chat_member(upd)
        elif 'message' in upd:
            handle_message(upd['message'])
        elif 'callback_query' in upd:
            proposals.handle_callback(upd['callback_query'], admin_ids())
    except Exception as e:
        print('dispatch error: %s' % e, flush=True)


def main():
    global _tg, _cfg
    _tg = config.load_telegram_config()
    if not _tg:
        raise SystemExit('telegram.json не найден (.credentials/)')
    tg.init(_tg['bot_token'])
    _cfg = config.load_config()
    print('BL-36 listener started, project=%s' % _cfg['project_id'], flush=True)

    threading.Thread(target=sense_loop, daemon=True).start()
    print('sense scheduler: каждые %d с' % int(_cfg['sense_interval_sec']),
          flush=True)

    def _digest_chat_id():
        cfg = config.load_config()
        return cfg.get('digest_chat_id') or _tg.get('owner_id')

    threading.Thread(target=digest.digest_loop,
                     args=(config.load_config, _digest_chat_id),
                     daemon=True).start()
    print('digest scheduler: %s МСК' % _cfg.get('digest_time_msk', '09:17'),
          flush=True)

    global _offset
    while True:
        try:
            res = tg.tg_call('getUpdates', offset=_offset,
                             timeout=tg.POLL_TIMEOUT,
                             allowed_updates=['message', 'my_chat_member',
                                              'callback_query'])
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
