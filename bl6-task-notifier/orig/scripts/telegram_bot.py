#!/usr/bin/env python3
"""
Telegram Bot Polling для реестра поручений.
Запускается как фоновый процесс и слушает сообщения из Telegram.
Поддерживает inline-кнопки для быстрого доступа к командам.
"""

import os
import sys
import time
import json
import signal

# Пути
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

from telegram_handler import (
    handle_text_message,
    handle_voice_message,
    handle_callback_query,
    get_main_menu_keyboard,
    get_welcome_text,
)

# Конфиг
CREDS_DIR = os.path.join(SCRIPT_DIR, '..', '.credentials')
CONFIG_PATH = os.path.join(CREDS_DIR, 'telegram.json')

# PID файл для управления процессом
PID_FILE = os.path.join(SCRIPT_DIR, '..', '.telegram_bot.pid')

running = True


def load_config():
    if not os.path.exists(CONFIG_PATH):
        print(f"❌ Конфиг не найден: {CONFIG_PATH}")
        return None
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def tg_api(method, bot_token, payload=None, params=None):
    """Универсальный вызов Telegram Bot API."""
    import requests
    url = f"https://api.telegram.org/bot{bot_token}/{method}"
    try:
        if payload:
            resp = requests.post(url, json=payload, timeout=30)
        else:
            resp = requests.get(url, params=params, timeout=60)
        return resp.json() if resp.status_code == 200 else None
    except Exception as e:
        print(f"⚠️ API error ({method}): {e}")
        return None


def get_updates(offset=None, bot_token=None):
    params = {'timeout': 30}
    if offset:
        params['offset'] = offset
    return tg_api('getUpdates', bot_token, params=params)


def send_message(chat_id, text, bot_token, parse_mode='HTML', reply_markup=None):
    """Отправляет сообщение с опциональной inline keyboard."""
    payload = {
        'chat_id': chat_id,
        'text': text,
        'parse_mode': parse_mode,
    }
    if reply_markup:
        payload['reply_markup'] = reply_markup
    
    result = tg_api('sendMessage', bot_token, payload=payload)
    if result is None:
        # Fallback без форматирования
        payload['parse_mode'] = ''
        payload.pop('reply_markup', None)
        tg_api('sendMessage', bot_token, payload=payload)


def answer_callback_query(callback_query_id, bot_token, text=None):
    """Подтверждает обработку callback query (убирает "часики" на кнопке)."""
    payload = {'callback_query_id': callback_query_id}
    if text:
        payload['text'] = text
    tg_api('answerCallbackQuery', bot_token, payload=payload)


def process_message_update(update, config):
    """Обрабатывает текстовое или голосовое сообщение."""
    bot_token = config['bot_token']
    allowed_chat = str(config.get('chat_id', ''))
    
    message = update.get('message', {})
    chat = message.get('chat', {})
    chat_id = str(chat.get('id', ''))
    
    # Проверяем whitelist
    if allowed_chat and chat_id != allowed_chat:
        return
    
    # Получаем username отправителя
    from_user = message.get('from', {})
    username = from_user.get('username', '') or from_user.get('first_name', 'Unknown')
    chat_id_int = int(chat_id)
    
    # Проверяем голосовое сообщение
    if 'voice' in message:
        voice_file_id = message['voice']['file_id']
        result = handle_voice_message(voice_file_id, bot_token)
        send_message(chat_id, result, bot_token, parse_mode='HTML')
        return
    
    # Текстовое сообщение
    text = message.get('text', '')
    if not text:
        return
    
    # Обрабатываем через handler
    result, keyboard = handle_text_message(text, chat_id_int, username)
    send_message(chat_id, result, bot_token, parse_mode='HTML', reply_markup=keyboard)


def process_callback_update(update, config):
    """Обрабатывает нажатие inline-кнопки."""
    bot_token = config['bot_token']
    callback = update.get('callback_query', {})
    
    callback_id = callback.get('id')
    callback_data = callback.get('data', '')
    message = callback.get('message', {})
    chat = message.get('chat', {})
    chat_id = str(chat.get('id', ''))
    
    # Проверяем whitelist
    allowed_chat = str(config.get('chat_id', ''))
    if allowed_chat and chat_id != allowed_chat:
        answer_callback_query(callback_id, bot_token, "Доступ запрещён")
        return
    
    from_user = callback.get('from', {})
    username = from_user.get('username', '') or from_user.get('first_name', 'Unknown')
    chat_id_int = int(chat_id)
    
    # Подтверждаем callback
    answer_callback_query(callback_id, bot_token)
    
    # Обрабатываем команду
    result, keyboard = handle_callback_query(callback_data, chat_id_int, username)
    
    # Редактируем сообщение или отправляем новое
    message_id = message.get('message_id')
    if message_id:
        # Пробуем отредактировать текущее сообщение
        payload = {
            'chat_id': chat_id,
            'message_id': message_id,
            'text': result,
            'parse_mode': 'HTML',
        }
        if keyboard:
            payload['reply_markup'] = keyboard
        
        edit_result = tg_api('editMessageText', bot_token, payload=payload)
        if edit_result is None or not edit_result.get('ok'):
            # Если не удалось отредактировать — отправляем новое
            send_message(chat_id, result, bot_token, parse_mode='HTML', reply_markup=keyboard)
    else:
        send_message(chat_id, result, bot_token, parse_mode='HTML', reply_markup=keyboard)


def process_update(update, config):
    """Обрабатывает одно обновление от Telegram."""
    if 'callback_query' in update:
        process_callback_update(update, config)
    elif 'message' in update:
        process_message_update(update, config)


def signal_handler(signum, frame):
    global running
    print("\n🛑 Получен сигнал остановки...")
    running = False


def write_pid():
    with open(PID_FILE, 'w') as f:
        f.write(str(os.getpid()))


def remove_pid():
    if os.path.exists(PID_FILE):
        os.remove(PID_FILE)


def main():
    global running
    
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    # Проверяем, не запущен ли уже
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, 'r') as f:
                old_pid = int(f.read().strip())
            if os.name == 'nt':
                import ctypes
                kernel = ctypes.windll.kernel32
                handle = kernel.OpenProcess(1, False, old_pid)
                if handle:
                    kernel.CloseHandle(handle)
                    print(f"⚠️ Бот уже запущен (PID {old_pid})")
                    return
            else:
                os.kill(old_pid, 0)
                print(f"⚠️ Бот уже запущен (PID {old_pid})")
                return
        except (ProcessLookupError, ValueError, OSError):
            pass
    
    config = load_config()
    if not config:
        sys.exit(1)
    
    bot_token = config['bot_token']
    
    write_pid()
    
    print(f"🤖 Telegram бот запущен")
    print(f"   Chat ID: {config.get('chat_id')}")
    print(f"   PID: {os.getpid()}")
    print(f"   Нажмите Ctrl+C для остановки\n")
    
    # Отправляем приветствие с кнопками
    welcome_text = get_welcome_text("")
    send_message(
        config['chat_id'],
        welcome_text,
        bot_token,
        reply_markup=get_main_menu_keyboard()
    )
    
    offset = None
    consecutive_errors = 0
    
    try:
        while running:
            try:
                data = get_updates(offset, bot_token)
                
                if data and data.get('ok'):
                    consecutive_errors = 0
                    updates = data.get('result', [])
                    
                    for update in updates:
                        update_id = update.get('update_id')
                        if update_id:
                            offset = update_id + 1
                        
                        process_update(update, config)
                else:
                    consecutive_errors += 1
                    if consecutive_errors > 5:
                        print("⚠️ Слишком много ошибок, жду 30 сек...")
                        time.sleep(30)
                        consecutive_errors = 0
                
                time.sleep(1)
                
            except Exception as e:
                print(f"⚠️ Ошибка в цикле: {e}")
                time.sleep(5)
    
    finally:
        remove_pid()
        print("👋 Бот остановлен")


if __name__ == '__main__':
    main()
