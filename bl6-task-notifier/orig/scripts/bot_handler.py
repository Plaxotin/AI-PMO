#!/usr/bin/env python3
"""
Обработчик команд бота @Plaxotin_task_bot в группах.
Слушает сообщения через long polling и выполняет команды по реестру поручений.
Все команды передаются через inline-кнопки.
"""

import os
import sys
import json
import re
import time
import html
import subprocess
from typing import Optional, Dict, List, Tuple

# Пути
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.join(SCRIPT_DIR, '..')
CREDS_DIR = os.path.join(SKILL_DIR, '.credentials')
CONFIG_PATH = os.path.join(CREDS_DIR, 'config.json')
TELEGRAM_CONFIG = os.path.join(CREDS_DIR, 'telegram.json')

# Для запросов к Telegram
try:
    import requests
except ImportError:
    print("Установите requests: pip install requests")
    sys.exit(1)


# ======== СОСТОЯНИЯ ПОЛЬЗОВАТЕЛЕЙ ========
# Ключ — "chat_id:user_id", чтобы в группе состояния разных людей не пересекались
_user_states: Dict[str, Dict] = {}


def _state_key(chat_id, user_id) -> str:
    return f"{chat_id}:{user_id}"


def _set_user_state(key: str, state: str, data: Dict = None):
    _user_states[key] = {"state": state, "data": data or {}}


def _get_user_state(key: str) -> Optional[Dict]:
    return _user_states.get(key)


def _clear_user_state(key: str):
    _user_states.pop(key, None)


# ======== INLINE КЛАВИАТУРА ========

def get_main_menu_keyboard() -> Dict:
    """Главное меню с кнопками."""
    return {
        "inline_keyboard": [
            [
                {"text": "📋 Мои поручения", "callback_data": "list_my"},
                {"text": "📋 Все поручения", "callback_data": "list_all"},
            ],
            [
                {"text": "✅ Закрыть поручение", "callback_data": "close_task"},
                {"text": "📅 Изменить срок", "callback_data": "change_deadline"},
            ],
            [
                {"text": "🔄 Сменить статус", "callback_data": "change_status"},
                {"text": "ℹ️ Показать поручение", "callback_data": "show_task"},
            ],
        ]
    }


def get_cancel_keyboard() -> Dict:
    """Клавиатура с кнопкой отмены."""
    return {
        "inline_keyboard": [
            [{"text": "❌ Отмена", "callback_data": "cancel"}]
        ]
    }


def get_status_keyboard(task_id: str) -> Dict:
    """Клавиатура выбора статуса."""
    statuses = ["Новое", "В работе", "На проверке", "Выполнено", "Отменено"]
    buttons = []
    for status in statuses:
        callback = f"set_status:{task_id}:{status}"
        buttons.append({"text": status, "callback_data": callback})
    # Разбиваем по 2 в ряд
    keyboard = [buttons[i:i+2] for i in range(0, len(buttons), 2)]
    keyboard.append([{"text": "❌ Отмена", "callback_data": "cancel"}])
    return {"inline_keyboard": keyboard}


# ======== КОНФИГ И API ========

def load_telegram_config() -> Dict:
    """Загружает конфиг Telegram."""
    with open(TELEGRAM_CONFIG, 'r', encoding='utf-8') as f:
        return json.load(f)


def tg_api(method: str, params: Dict = None) -> Dict:
    """Вызов метода Telegram Bot API."""
    config = load_telegram_config()
    url = f"https://api.telegram.org/bot{config['bot_token']}/{method}"
    # read timeout должен быть больше long-poll timeout, иначе гонка → "Read timed out"
    poll = (params or {}).get('timeout', 0)
    req_timeout = (10, poll + 15) if poll else 30
    try:
        resp = requests.post(url, json=params or {}, timeout=req_timeout)
        return resp.json()
    except Exception as e:
        print(f"Ошибка API: {e}")
        return {"ok": False}


def send_message(chat_id, text: str, reply_to: int = None, reply_markup: Dict = None) -> bool:
    """Отправляет сообщение с опциональной inline keyboard."""
    payload = {
        'chat_id': chat_id,
        'text': text,
        'parse_mode': 'HTML'
    }
    if reply_to:
        payload['reply_to_message_id'] = reply_to
    if reply_markup:
        payload['reply_markup'] = reply_markup
    result = tg_api('sendMessage', payload)
    return result.get('ok', False)


def edit_message(chat_id, message_id: int, text: str, reply_markup: Dict = None) -> bool:
    """Редактирует существующее сообщение."""
    payload = {
        'chat_id': chat_id,
        'message_id': message_id,
        'text': text,
        'parse_mode': 'HTML'
    }
    if reply_markup:
        payload['reply_markup'] = reply_markup
    result = tg_api('editMessageText', payload)
    return result.get('ok', False)


def answer_callback_query(callback_query_id: str, text: str = None):
    """Подтверждает обработку callback query (убирает часики на кнопке)."""
    payload = {'callback_query_id': callback_query_id}
    if text:
        payload['text'] = text
    tg_api('answerCallbackQuery', payload)


# ======== TASK MANAGER ========

def run_task_manager(*args) -> Tuple[bool, str]:
    """Запускает task_manager.py с указанными аргументами."""
    cmd = [sys.executable, os.path.join(SCRIPT_DIR, 'task_manager.py')] + list(args)
    env = os.environ.copy()
    env['PYTHONIOENCODING'] = 'utf-8'
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=60)
        output = result.stdout + result.stderr
        return result.returncode == 0, output
    except Exception as e:
        return False, str(e)


def get_all_tasks() -> List[Dict]:
    """Получает все поручения из реестра."""
    success, output = run_task_manager('list')
    if not success:
        return []
    
    tasks = []
    for line in output.split('\n'):
        line = line.strip()
        if not line or line.startswith('Найдено') or line.startswith('ID') or line.startswith('-'):
            continue
        # Парсим формат: ID Статус Срок Контрагент Ответственный Описание
        parts = line.split(None, 5)
        if len(parts) >= 5:
            tasks.append({
                'id': parts[0],
                'status': parts[1],
                'deadline': parts[2],
                'project': parts[3],
                'assignee': parts[4],
                'description': parts[5] if len(parts) > 5 else ''
            })
    return tasks


def get_task_info(task_id: int) -> Optional[Dict]:
    """Получает информацию о поручении по ID."""
    tasks = get_all_tasks()
    for task in tasks:
        if task['id'] == str(task_id):
            return task
    return None


def load_user_mapping() -> Dict[str, str]:
    """Загружает карту соответствия имя → Telegram username."""
    mapping_file = os.path.join(CREDS_DIR, 'user_mapping.json')
    if not os.path.exists(mapping_file):
        return {}
    try:
        with open(mapping_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def get_assignee_by_telegram(username: str) -> Optional[str]:
    """Определяет имя в реестре по Telegram username."""
    mapping = load_user_mapping()
    username_clean = username.lstrip('@').lower()
    for name, tg in mapping.items():
        if tg.lstrip('@').lower() == username_clean:
            return name
    return None


# ======== ФОРМАТИРОВАНИЕ ========

def format_task_list(tasks: List[Dict], title: str) -> str:
    """Форматирует список поручений."""
    if not tasks:
        return f"📭 {title}\n\nПоручений не найдено."
    
    lines = [f"<b>{title}</b> ({len(tasks)} шт.)\n"]
    
    for task in tasks:
        tid = task.get('id', '?')
        status = task.get('status', '?')
        deadline = task.get('deadline', '?')
        project = task.get('project', 'Без проекта')
        desc = task.get('description', '')
        assignee = task.get('assignee', '?')
        
        status_emoji = {
            "Новое": "🆕",
            "В работе": "🔵",
            "На проверке": "🟡",
            "Выполнено": "✅",
            "Отменено": "❌",
            "Просрочено": "🔴",
        }.get(status, "⚪")
        
        desc_short = desc[:60] + "…" if len(desc) > 60 else desc
        project_short = project[:20] + "…" if len(project) > 20 else project
        
        lines.append(
            f"<b>#{tid}</b> {status_emoji} <b>{status}</b>\n"
            f"   📁 {html.escape(project_short)}\n"
            f"   📝 {html.escape(desc_short)}\n"
            f"   👤 {html.escape(assignee)}  📅 {deadline}\n"
        )
    
    return "\n".join(lines)


# ======== КОМАНДЫ ========

def cmd_list_my(username: str) -> str:
    """Показать поручения текущего пользователя."""
    assignee = get_assignee_by_telegram(username)
    if not assignee:
        return (
            f"❓ Не удалось определить ваше имя в реестре.\n"
            f"   Ваш Telegram: @{username}\n\n"
            f"   Добавьте соответствие в файл user_mapping.json"
        )
    
    tasks = get_all_tasks()
    filtered = [t for t in tasks if assignee.lower() in t.get('assignee', '').lower()]
    # Убираем закрытые
    filtered = [t for t in filtered if t.get('status') not in ("Выполнено", "Отменено")]
    return format_task_list(filtered, f"📋 Мои поручения — {assignee}")


def cmd_list_all() -> str:
    """Показать все поручения."""
    tasks = get_all_tasks()
    return format_task_list(tasks, "📋 Все поручения")


def cmd_close_task(task_id: str, username: str) -> str:
    """Закрыть поручение."""
    assignee = get_assignee_by_telegram(username)
    if not assignee:
        return f"❌ Не удалось определить ваше имя в реестре."
    
    task = get_task_info(int(task_id))
    if not task:
        return f"❌ Поручение <b>#{task_id}</b> не найдено."
    
    if assignee.lower() not in task.get('assignee', '').lower():
        return (
            f"❌ Поручение <b>#{task_id}</b> назначено на <b>{task['assignee']}</b>.\n"
            f"   Вы ({assignee}) не можете его закрыть."
        )
    
    success, output = run_task_manager('update', task_id, '--status', 'Выполнено')
    if success and ('обновлено' in output or 'Выполнено' in output):
        return (
            f"✅ Поручение <b>#{task_id}</b> закрыто!\n\n"
            f"   📝 {html.escape(task.get('description', ''))}\n"
            f"   📅 Дата закрытия: {time.strftime('%d.%m.%Y')}"
        )
    return f"❌ Не удалось закрыть #{task_id}.\n<code>{html.escape(output[:200])}</code>"


def cmd_change_deadline(task_id: str, new_deadline: str, username: str) -> str:
    """Изменить срок поручения."""
    assignee = get_assignee_by_telegram(username)
    if not assignee:
        return f"❌ Не удалось определить ваше имя в реестре."
    
    task = get_task_info(int(task_id))
    if not task:
        return f"❌ Поручение <b>#{task_id}</b> не найдено."
    
    if assignee.lower() not in task.get('assignee', '').lower():
        return (
            f"❌ Поручение <b>#{task_id}</b> назначено на <b>{task['assignee']}</b>.\n"
            f"   Вы ({assignee}) не можете изменить его срок."
        )
    
    success, output = run_task_manager('update', task_id, '--deadline', new_deadline)
    if success and ('обновлено' in output or 'Срок' in output):
        return (
            f"✅ Срок поручения <b>#{task_id}</b> изменён!\n\n"
            f"   📝 {html.escape(task.get('description', ''))}\n"
            f"   📅 Новый срок: <b>{new_deadline}</b>"
        )
    return f"❌ Не удалось изменить срок #{task_id}.\n<code>{html.escape(output[:200])}</code>"


def cmd_change_status(task_id: str, new_status: str, username: str) -> str:
    """Сменить статус поручения."""
    assignee = get_assignee_by_telegram(username)
    if not assignee:
        return f"❌ Не удалось определить ваше имя в реестре."
    
    task = get_task_info(int(task_id))
    if not task:
        return f"❌ Поручение <b>#{task_id}</b> не найдено."
    
    success, output = run_task_manager('update', task_id, '--status', new_status)
    if success and ('обновлено' in output or 'Статус' in output):
        return (
            f"🔄 Статус поручения <b>#{task_id}</b> изменён на <b>{new_status}</b>!\n\n"
            f"   📝 {html.escape(task.get('description', ''))}"
        )
    return f"❌ Не удалось изменить статус #{task_id}.\n<code>{html.escape(output[:200])}</code>"


def cmd_show_task(task_id: str) -> str:
    """Показать информацию о поручении."""
    task = get_task_info(int(task_id))
    if not task:
        return f"❌ Поручение <b>#{task_id}</b> не найдено."
    
    status_emoji = {
        "Новое": "🆕",
        "В работе": "🔵",
        "На проверке": "🟡",
        "Выполнено": "✅",
        "Отменено": "❌",
        "Просрочено": "🔴",
    }.get(task.get('status', ''), "⚪")
    
    return (
        f"📋 <b>Поручение #{task_id}</b>\n\n"
        f"📝 Описание: {html.escape(task.get('description', ''))}\n"
        f"📁 Проект: {html.escape(task.get('project', ''))}\n"
        f"{status_emoji} Статус: <b>{task.get('status', '?')}</b>\n"
        f"📅 Срок: {task.get('deadline', '?')}\n"
        f"👤 Ответственный: {html.escape(task.get('assignee', '?'))}"
    )


# ======== ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ========

def handle_text_message(text: str, key: str, username: str, first_name: str) -> Tuple[str, Optional[Dict]]:
    """Обрабатывает входящее текстовое сообщение.

    Returns:
        (текст ответа, keyboard или None)
    """
    text = text.strip()
    text_lower = text.lower()

    # Проверяем состояние пользователя (многошаговые команды)
    state = _get_user_state(key)

    if state:
        if state["state"] == "waiting_close_id":
            task_id = text.strip()
            if not task_id.isdigit():
                return "❌ Номер поручения должен быть числом. Попробуйте ещё раз или нажмите «❌ Отмена».", get_cancel_keyboard()
            _clear_user_state(key)
            return cmd_close_task(task_id, username), get_main_menu_keyboard()

        if state["state"] == "waiting_deadline_id":
            task_id = text.strip()
            if not task_id.isdigit():
                return "❌ Номер поручения должен быть числом. Попробуйте ещё раз или нажмите «❌ Отмена».", get_cancel_keyboard()
            _set_user_state(key, "waiting_deadline_date", {"task_id": task_id})
            return (
                f"📅 Введите новый срок для поручения <b>#{task_id}</b>:\n\n"
                f"Например: <code>20.08.2026</code>, <code>завтра</code>"
            ), get_cancel_keyboard()

        if state["state"] == "waiting_deadline_date":
            task_id = state["data"]["task_id"]
            _clear_user_state(key)
            return cmd_change_deadline(task_id, text, username), get_main_menu_keyboard()

        if state["state"] == "waiting_status_id":
            task_id = text.strip()
            if not task_id.isdigit():
                return "❌ Номер поручения должен быть числом. Попробуйте ещё раз или нажмите «❌ Отмена».", get_cancel_keyboard()
            _set_user_state(key, "waiting_status_select", {"task_id": task_id})
            return (
                f"🔄 Выберите новый статус для поручения <b>#{task_id}</b>:"
            ), get_status_keyboard(task_id)

        if state["state"] == "waiting_show_id":
            task_id = text.strip()
            if not task_id.isdigit():
                return "❌ Номер поручения должен быть числом. Попробуйте ещё раз или нажмите «❌ Отмена».", get_cancel_keyboard()
            _clear_user_state(key)
            return cmd_show_task(task_id), get_main_menu_keyboard()

    # Если просто текст без команды — показываем меню с кнопками
    return get_welcome_text(first_name, username), get_main_menu_keyboard()


def get_welcome_text(first_name: str, username: str) -> str:
    """Приветственное сообщение с меню."""
    return (
        f"👋 <b>Привет, {html.escape(first_name)}!</b>\n\n"
        f"Я бот для управления реестром поручений.\n"
        f"Выберите действие:\n\n"
        f"📋 <b>Мои поручения</b> — ваши активные задачи\n"
        f"📋 <b>Все поручения</b> — полный список\n"
        f"✅ <b>Закрыть поручение</b> — отметить выполненным\n"
        f"📅 <b>Изменить срок</b> — перенести дедлайн\n"
        f"🔄 <b>Сменить статус</b> — изменить статус\n"
        f"ℹ️ <b>Показать поручение</b> — информация по номеру"
    )


# ======== ОБРАБОТКА CALLBACK (кнопки) ========

def handle_callback_query(callback_data: str, key: str, username: str, first_name: str) -> Tuple[str, Optional[Dict]]:
    """Обрабатывает нажатие inline-кнопки.

    Returns:
        (текст ответа, keyboard или None)
    """
    if callback_data == "list_my":
        return cmd_list_my(username), get_main_menu_keyboard()

    if callback_data == "list_all":
        return cmd_list_all(), get_main_menu_keyboard()

    if callback_data == "close_task":
        _set_user_state(key, "waiting_close_id")
        return (
            "✅ <b>Закрыть поручение</b>\n\n"
            "Введите номер поручения (например: <code>12</code>):"
        ), get_cancel_keyboard()

    if callback_data == "change_deadline":
        _set_user_state(key, "waiting_deadline_id")
        return (
            "📅 <b>Изменить срок поручения</b>\n\n"
            "Введите номер поручения (например: <code>12</code>):"
        ), get_cancel_keyboard()

    if callback_data == "change_status":
        _set_user_state(key, "waiting_status_id")
        return (
            "🔄 <b>Сменить статус поручения</b>\n\n"
            "Введите номер поручения (например: <code>12</code>):"
        ), get_cancel_keyboard()

    if callback_data == "show_task":
        _set_user_state(key, "waiting_show_id")
        return (
            "ℹ️ <b>Показать поручение</b>\n\n"
            "Введите номер поручения (например: <code>12</code>):"
        ), get_cancel_keyboard()

    if callback_data == "cancel":
        _clear_user_state(key)
        return "❌ Отменено.", get_main_menu_keyboard()

    # Обработка set_status:ID:STATUS
    if callback_data.startswith("set_status:"):
        parts = callback_data.split(":")
        if len(parts) == 3:
            _, task_id, status = parts
            _clear_user_state(key)
            return cmd_change_status(task_id, status, username), get_main_menu_keyboard()

    return "❓ Неизвестная команда.", get_main_menu_keyboard()


# ======== УВЕДОМЛЕНИЯ ========

def notify_admin(notification_text: str):
    """Отправляет уведомление админу."""
    config = load_telegram_config()
    admin_chat = config.get('user_chat_id') or config.get('chat_id')
    if admin_chat:
        tg_api('sendMessage', {
            'chat_id': admin_chat,
            'text': notification_text,
            'parse_mode': 'HTML'
        })


# ======== ОСНОВНОЙ ЦИКЛ ========

def process_updates(updates: List[Dict]):
    """Обрабатывает список обновлений."""
    config = load_telegram_config()
    bot_username = "Plaxotin_task_bot"
    
    for update in updates:
        # Обработка callback query (нажатие кнопки)
        if 'callback_query' in update:
            callback = update['callback_query']
            callback_id = callback.get('id')
            callback_data = callback.get('data', '')
            message = callback.get('message', {})
            chat = message.get('chat', {})
            chat_id = chat.get('id')
            message_id = message.get('message_id')

            from_user = callback.get('from', {})
            username = from_user.get('username', '')
            first_name = from_user.get('first_name', '')
            key = _state_key(chat_id, from_user.get('id'))

            # Подтверждаем callback
            answer_callback_query(callback_id)

            # Обрабатываем команду
            result, keyboard = handle_callback_query(callback_data, key, username, first_name)

            # Редактируем сообщение
            if message_id:
                edit_message(chat_id, message_id, result, reply_markup=keyboard)
            else:
                send_message(chat_id, result, reply_markup=keyboard)

            # Уведомляем админа
            admin_msg = (
                f"🔔 <b>Действие в группе (кнопка)</b>\n\n"
                f"👤 <b>{html.escape(first_name)}</b> (@{username})\n"
                f"🔘 Кнопка: <code>{html.escape(callback_data)}</code>\n\n"
                f"📍 Группа: {html.escape(chat.get('title', 'Unknown'))}\n\n"
                f"🤖 Ответ бота:\n{result[:500]}"
            )
            notify_admin(admin_msg)
            continue

        # Обработка текстовых сообщений
        message = update.get('message')
        if not message:
            continue

        text = message.get('text', '')
        if not text:
            continue
        chat = message.get('chat', {})
        chat_id = chat.get('id')

        # В группе реагируем только на упоминание бота; в личке — на любой текст
        mention = f'@{bot_username}'
        if chat.get('type') == 'private':
            pass
        elif mention in text:
            text = text.replace(mention, '').strip()
        else:
            continue

        from_user = message.get('from', {})
        username = from_user.get('username', '')
        first_name = from_user.get('first_name', '')
        key = _state_key(chat_id, from_user.get('id'))

        # Обрабатываем команду
        response, keyboard = handle_text_message(text, key, username, first_name)

        # Отправляем ответ
        send_message(chat_id, response, reply_to=message.get('message_id'), reply_markup=keyboard)

        # Уведомляем админа
        admin_msg = (
            f"🔔 <b>Действие в группе</b>\n\n"
            f"👤 <b>{html.escape(first_name)}</b> (@{username})\n"
            f"💬 {html.escape(text[:200])}\n\n"
            f"📍 Группа: {html.escape(chat.get('title', 'Unknown'))}\n\n"
            f"🤖 Ответ бота:\n{response[:500]}"
        )
        notify_admin(admin_msg)


def main_loop():
    """Основной цикл polling."""
    print("🤖 Бот запущен. Слушаю сообщения...")
    offset = 0
    
    while True:
        try:
            result = tg_api('getUpdates', {
                'offset': offset,
                'limit': 100,
                'timeout': 30
            })
            
            if not result.get('ok'):
                time.sleep(5)
                continue
            
            updates = result.get('result', [])
            if updates:
                # Обновляем offset
                offset = updates[-1]['update_id'] + 1
                process_updates(updates)
            
            time.sleep(1)
            
        except KeyboardInterrupt:
            print("\n👋 Бот остановлен.")
            break
        except Exception as e:
            print(f"Ошибка: {e}")
            time.sleep(5)


if __name__ == '__main__':
    main_loop()
