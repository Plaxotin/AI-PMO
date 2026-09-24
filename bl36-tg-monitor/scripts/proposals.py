#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BL-36: карточки предложений РП и обработка решений (✓ / ✕ / ✎→✓).

SPEC-BL-36 §5: блок «Почему предлагает», кликабельный источник, бейдж канала,
третье действие «Изменить и принять». Утверждает только РП (admin_ids).
Запись подтверждённого в реестр Google Sheets — фаза 3 (sheets_bridge);
пока фиксируется статус proposal (confirmed/edited_confirmed/rejected).
"""

import datetime as dt

import config
import db
import tg

TYPE_RU = {'assignment': '📌 Поручение', 'decision': '🤝 Решение',
           'risk': '⚠️ Риск'}

# ожидание правки: {user_id: proposal_id} (in-memory, SPEC допускает
# пересоздание при рестарте — предложение не теряется, статус в Supabase)
_awaiting_edit = {}


def _short_id(pid):
    return str(pid).split('-')[0].upper()


def _card_text(proposal, signal):
    p = proposal['payload']
    lines = ['📥 Предложение · %s · P-%s' %
             (TYPE_RU.get(proposal['target'], proposal['target']),
              _short_id(proposal['id'])), '']
    lines.append(p.get('text') or '')
    meta = []
    if p.get('assignee'):
        meta.append('👤 %s' % p['assignee'])
    if p.get('due'):
        meta.append('📅 %s' % p['due'])
    if meta:
        lines += ['', ' · '.join(meta)]
    if signal.get('rationale'):
        lines += ['', '💬 Почему предлагает: %s' % signal['rationale']]
    links = [l for l in (p.get('source_links') or []) if l]
    if links:
        lines += ['', '🔗 Источник (TG · %s): %s' %
                  (p.get('channel_title') or 'чат', links[0])]
    conf = signal.get('confidence')
    if conf is not None:
        lines += ['', 'Уверенность: %.2f' % float(conf)]
    if p.get('edited'):
        lines.append('✎ (отредактировано РП)')
    return '\n'.join(lines)


def _keyboard(pid):
    return {'inline_keyboard': [[
        {'text': '✅ Принять', 'callback_data': 'p:ok:%s' % pid},
        {'text': '✎ Изменить', 'callback_data': 'p:edit:%s' % pid},
        {'text': '✕ Отклонить', 'callback_data': 'p:no:%s' % pid},
    ]]}


def send_proposal(owner_id, proposal, signal):
    """Карточка предложения РП в личку."""
    res = tg.send_message(owner_id, _card_text(proposal, signal),
                          reply_markup=_keyboard(proposal['id']))
    if res:
        db.update('bl36_proposals', {'id': 'eq.%s' % proposal['id']},
                  {'tg_message_id': res.get('message_id')})


def send_pending(owner_id):
    """Отправить РП все предложения со статусом pending (рестарт/догон)."""
    rows = db.select('bl36_proposals', {'status': 'eq.pending',
                                        'select': '*,bl36_signals(*)'})
    for pr in rows:
        sig = pr.pop('bl36_signals', None) or {}
        send_proposal(owner_id, pr, sig)


def handle_callback(cb, admin_ids):
    """callback_query от кнопок предложения. True, если обработано."""
    data = cb.get('data') or ''
    if not data.startswith('p:'):
        return False
    cb_id = cb['id']
    user_id = (cb.get('from') or {}).get('id')
    msg = cb.get('message') or {}
    chat_id = (msg.get('chat') or {}).get('id')

    if user_id not in admin_ids:
        tg.answer_callback(cb_id, 'Утверждать предложения может только РП')
        return True

    try:
        _, action, pid = data.split(':', 2)
    except ValueError:
        tg.answer_callback(cb_id)
        return True

    rows = db.select('bl36_proposals', {'id': 'eq.%s' % pid,
                                        'select': '*,bl36_signals(*)'})
    if not rows:
        tg.answer_callback(cb_id, 'Предложение не найдено')
        return True
    pr = rows[0]
    sig = pr.pop('bl36_signals', None) or {}

    # Атомарный захват: меняем статус только если он всё ещё pending
    # (защита от гонки при быстрых двойных нажатиях).
    if action == 'ok':
        new_status = 'edited_confirmed' if (pr['payload'] or {}).get('edited') \
            else 'confirmed'
    elif action == 'no':
        new_status = 'rejected'
    else:  # edit — статус не меняем, захват no-op'ом
        new_status = 'pending'
    taken = db.update('bl36_proposals',
                      {'id': 'eq.%s' % pid, 'status': 'eq.pending'},
                      {'status': new_status,
                       'decided_by': user_id if action != 'edit' else None,
                       'decided_at': dt.datetime.now(dt.timezone.utc)
                       .isoformat() if action != 'edit' else None},
                      check_rows=True)
    if not taken:
        tg.answer_callback(cb_id, 'Уже обработано')
        return True
    pr['status'] = new_status

    if action == 'ok':
        decided_name = (cb.get('from') or {}).get('first_name') or 'РП'
        try:
            import sheets_bridge
            result = sheets_bridge.write_to_registry(pr, decided_name)
            payload = dict(pr['payload'] or {})
            payload['registry_ref'] = result
            db.update('bl36_proposals', {'id': 'eq.%s' % pid},
                      {'payload': payload})
            tail = '\n\n✅ ПРИНЯТО → %s' % result
        except Exception as e:
            print('sheets_bridge error: %s' % e, flush=True)
            tail = ('\n\n✅ ПРИНЯТО, но запись в реестр не удалась: %s'
                    % str(e)[:150])
        tg.edit_message(chat_id, msg.get('message_id'),
                        _card_text(pr, sig) + tail)
        tg.answer_callback(cb_id, 'Принято ✅')
    elif action == 'no':
        tg.edit_message(chat_id, msg.get('message_id'),
                        _card_text(pr, sig) + '\n\n✕ ОТКЛОНЕНО')
        tg.answer_callback(cb_id, 'Отклонено')
    elif action == 'edit':
        _awaiting_edit[user_id] = pid
        tg.answer_callback(cb_id)
        tg.send_message(chat_id,
                        '✎ Пришлите исправленную формулировку одним '
                        'сообщением — я обновлю предложение P-%s и покажу '
                        'снова.' % _short_id(pid))
    return True


def handle_edit_input(msg, admin_ids):
    """Текст от РП в режиме правки. True, если сообщение поглощено."""
    user_id = (msg.get('from') or {}).get('id')
    pid = _awaiting_edit.pop(user_id, None)
    if not pid:
        return False
    if user_id not in admin_ids:
        return True
    text = (msg.get('text') or '').strip()
    if not text:
        return True
    rows = db.select('bl36_proposals', {'id': 'eq.%s' % pid,
                                        'select': '*,bl36_signals(*)'})
    if not rows:
        tg.send_message(msg['chat']['id'], 'Предложение не найдено.')
        return True
    pr = rows[0]
    sig = pr.pop('bl36_signals', None) or {}
    payload = dict(pr['payload'] or {})
    payload['text'] = text
    payload['edited'] = True
    pr['payload'] = payload
    db.update('bl36_proposals', {'id': 'eq.%s' % pid}, {'payload': payload})
    tg.send_message(msg['chat']['id'],
                    _card_text(pr, sig), reply_markup=_keyboard(pid))
    return True


def awaiting_count():
    return len(_awaiting_edit)
