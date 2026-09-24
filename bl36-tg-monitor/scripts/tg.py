#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Общие помощники Telegram Bot API для BL-36 (listener, sense, proposals)."""

import threading
import time

import requests

_token = None
_session = requests.Session()
POLL_TIMEOUT = 30


def init(token: str):
    global _token
    _token = token


def tg_call(method, **params):
    if not _token:
        raise RuntimeError('tg.init() не вызван')
    url = 'https://api.telegram.org/bot%s/%s' % (_token, method)
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
    params = {'chat_id': chat_id, 'text': text,
              'disable_web_page_preview': True}
    if reply_markup:
        params['reply_markup'] = reply_markup
    return tg_call('sendMessage', **params)


def edit_message(chat_id, message_id, text, reply_markup=None):
    params = {'chat_id': chat_id, 'message_id': message_id, 'text': text,
              'disable_web_page_preview': True}
    if reply_markup:
        params['reply_markup'] = reply_markup
    return tg_call('editMessageText', **params)


def answer_callback(cb_id, text=None):
    params = {'callback_query_id': cb_id}
    if text:
        params['text'] = text
    return tg_call('answerCallbackQuery', **params)
