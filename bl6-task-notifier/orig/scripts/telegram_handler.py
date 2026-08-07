"""
Обработчик входящих сообщений из Telegram для реестра поручений.

Использование:
- Отправь текстовое сообщение боту с описанием поручения
- Поддерживаются команды и естественный язык
- Inline-кнопки для быстрого доступа к командам

Примеры сообщений:
    /add проект "Альфа" описание "Сделать отчёт" ответственный Иванов срок 20.07.2026
    
    Добавь поручение: проект Альфа, сделать отчёт, Иванов, до 20.07
    
    Новое поручение — проект Бета: подготовить презентацию, Петров, срок 15 июля

Голосовые сообщения:
    Отправь голосовое — я распознаю текст через Yandex SpeechKit и создам поручение.
    (Ключ уже настроен в конфиге OpenClaw)

Команды через кнопки:
    📋 Мои поручения     — показать активные поручения текущего пользователя
    📋 Все поручения     — показать все поручения включая закрытые
    ✅ Закрыть поручение — закрыть поручение по номеру (только свои)
    📅 Изменить срок     — изменить срок поручения (только свои)
"""

import re
import os
import sys
import json
import html as html_module
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Tuple

# Пути
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.join(SCRIPT_DIR, '..')
CREDS_DIR = os.path.join(SKILL_DIR, '.credentials')

# Добавляем путь к task_manager.py
sys.path.insert(0, SCRIPT_DIR)

CLOSED_STATUSES = {"Выполнено", "Отменено"}


# ======== СОСТОЯНИЯ ПОЛЬЗОВАТЕЛЕЙ ========
_user_states: Dict[int, Dict] = {}


def _set_user_state(chat_id: int, state: str, data: Dict = None):
    _user_states[chat_id] = {"state": state, "data": data or {}}


def _get_user_state(chat_id: int) -> Optional[Dict]:
    return _user_states.get(chat_id)


def _clear_user_state(chat_id: int):
    _user_states.pop(chat_id, None)


# ======== INLINE КЛАВИАТУРА ========

def get_main_menu_keyboard() -> Dict:
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
        ]
    }


def get_cancel_keyboard() -> Dict:
    return {
        "inline_keyboard": [
            [{"text": "❌ Отмена", "callback_data": "cancel"}]
        ]
    }


# ======== GOOGLE SHEETS ========

def get_gsheets_client():
    import gspread
    from google.oauth2.service_account import Credentials
    
    creds_file = os.path.join(CREDS_DIR, 'gsheets-service-account.json')
    scopes = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ]
    creds = Credentials.from_service_account_file(creds_file, scopes=scopes)
    return gspread.authorize(creds)


def get_worksheet():
    config_path = os.path.join(CREDS_DIR, 'config.json')
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    client = get_gsheets_client()
    spreadsheet = client.open_by_key(config['spreadsheet_id'])
    return spreadsheet.sheet1


def load_user_mapping() -> Dict[str, str]:
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


def get_all_tasks() -> List[Dict]:
    """Возвращает все поручения из реестра."""
    worksheet = get_worksheet()
    values = worksheet.get_all_values()
    
    if len(values) <= 1:
        return []
    
    rows = values[1:]
    tasks = []
    
    for row in rows:
        if not row or not row[0]:
            continue
        tasks.append({
            "ID": row[0] if len(row) > 0 else "",
            "Дата создания": row[1] if len(row) > 1 else "",
            "Автор": row[2] if len(row) > 2 else "",
            "Проект": row[3] if len(row) > 3 else "",
            "Описание": row[4] if len(row) > 4 else "",
            "Ответственный": row[5] if len(row) > 5 else "",
            "Срок": row[6] if len(row) > 6 else "",
            "Статус": row[7] if len(row) > 7 else "",
            "Дата закрытия": row[8] if len(row) > 8 else "",
            "Комментарий": row[9] if len(row) > 9 else "",
        })
    
    return tasks


def get_tasks_for_assignee(assignee: str, include_closed: bool = False) -> List[Dict]:
    """Возвращает поручения для конкретного ответственного."""
    tasks = get_all_tasks()
    filtered = []
    
    for task in tasks:
        task_assignee = task.get("Ответственный", "")
        status = task.get("Статус", "")
        
        if assignee.lower() not in task_assignee.lower():
            continue
        
        if not include_closed and status in CLOSED_STATUSES:
            continue
        
        filtered.append(task)
    
    return filtered


# ======== ФОРМАТИРОВАНИЕ ========

def format_task_list(tasks: List[Dict], title: str) -> str:
    """Форматирует список поручений для Telegram."""
    if not tasks:
        return f"📭 {title}\n\nПоручений не найдено."
    
    lines = [f"<b>{title}</b> ({len(tasks)} шт.)\n"]
    
    for task in tasks:
        tid = task.get("ID", "?")
        status = task.get("Статус", "?")
        deadline = task.get("Срок", "?")
        project = task.get("Проект", "Без проекта")
        desc = task.get("Описание", "")
        assignee = task.get("Ответственный", "?")
        
        # Эмодзи по статусу
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
            f"   📁 {html_module.escape(project_short)}\n"
            f"   📝 {html_module.escape(desc_short)}\n"
            f"   👤 {html_module.escape(assignee)}  📅 {deadline}\n"
        )
    
    return "\n".join(lines)


# ======== КОМАНДЫ ========

def cmd_list_my(username: str) -> str:
    """Показать мои поручения (без закрытых)."""
    assignee = get_assignee_by_telegram(username)
    if not assignee:
        return (
            f"❓ Не удалось определить ваше имя в реестре.\n"
            f"   Ваш Telegram: @{username}\n\n"
            f"   Добавьте соответствие в файл user_mapping.json, например:\n"
            f"   \"Иванов И.И.\": \"@{username}\""
        )
    
    tasks = get_tasks_for_assignee(assignee, include_closed=False)
    return format_task_list(tasks, f"📋 Мои поручения — {assignee}")


def cmd_list_all() -> str:
    """Показать все поручения (включая закрытые)."""
    tasks = get_all_tasks()
    return format_task_list(tasks, "📋 Все поручения")


def cmd_close_task_prompt() -> str:
    """Запросить номер поручения для закрытия."""
    return (
        "✅ <b>Закрыть поручение</b>\n\n"
        "Введите номер поручения (например: <code>12</code>):"
    )


def cmd_change_deadline_prompt() -> str:
    """Запросить номер поручения для изменения срока."""
    return (
        "📅 <b>Изменить срок поручения</b>\n\n"
        "Введите номер поручения (например: <code>12</code>):"
    )


def do_close_task(task_id: str, username: str) -> str:
    """Закрыть поручение."""
    assignee = get_assignee_by_telegram(username)
    if not assignee:
        return f"❌ Не удалось определить ваше имя в реестре."
    
    tasks = get_all_tasks()
    for task in tasks:
        if task.get("ID") == str(task_id):
            task_assignee = task.get("Ответственный", "")
            if assignee.lower() not in task_assignee.lower():
                return (
                    f"❌ Поручение <b>#{task_id}</b> назначено на <b>{task_assignee}</b>.\n"
                    f"   Вы ({assignee}) не можете его закрыть."
                )
            
            # Обновляем в Google Sheets
            try:
                worksheet = get_worksheet()
                values = worksheet.get_all_values()
                for i, row in enumerate(values[1:], start=2):
                    if row and row[0] == str(task_id):
                        today = datetime.now().strftime("%d.%m.%Y")
                        worksheet.update_cell(i, 8, "Выполнено")
                        worksheet.update_cell(i, 9, today)
                        return (
                            f"✅ Поручение <b>#{task_id}</b> закрыто!\n\n"
                            f"   📝 {html_module.escape(task.get('Описание', ''))}\n"
                            f"   📅 Дата закрытия: {today}"
                        )
            except Exception as e:
                return f"❌ Ошибка при закрытии: {e}"
    
    return f"❌ Поручение <b>#{task_id}</b> не найдено."


def do_change_deadline(task_id: str, new_deadline: str, username: str) -> str:
    """Изменить срок поручения."""
    assignee = get_assignee_by_telegram(username)
    if not assignee:
        return f"❌ Не удалось определить ваше имя в реестре."
    
    # Валидируем дату
    parsed = parse_deadline(new_deadline)
    if not parsed:
        return (
            f"❌ Не удалось распознать дату: <b>{html_module.escape(new_deadline)}</b>\n\n"
            f"Поддерживаемые форматы:\n"
            f"• 20.07.2026\n"
            f"• 20.07\n"
            f"• сегодня, завтра, послезавтра"
        )
    
    tasks = get_all_tasks()
    for task in tasks:
        if task.get("ID") == str(task_id):
            task_assignee = task.get("Ответственный", "")
            if assignee.lower() not in task_assignee.lower():
                return (
                    f"❌ Поручение <b>#{task_id}</b> назначено на <b>{task_assignee}</b>.\n"
                    f"   Вы ({assignee}) не можете изменить его срок."
                )
            
            try:
                worksheet = get_worksheet()
                values = worksheet.get_all_values()
                for i, row in enumerate(values[1:], start=2):
                    if row and row[0] == str(task_id):
                        worksheet.update_cell(i, 7, parsed)
                        return (
                            f"✅ Срок поручения <b>#{task_id}</b> изменён!\n\n"
                            f"   📝 {html_module.escape(task.get('Описание', ''))}\n"
                            f"   📅 Новый срок: <b>{parsed}</b>"
                        )
            except Exception as e:
                return f"❌ Ошибка при изменении срока: {e}"
    
    return f"❌ Поручение <b>#{task_id}</b> не найдено."


# ======== CALLBACK ОБРАБОТКА ========

def handle_callback_query(callback_data: str, chat_id: int, username: str) -> Tuple[str, Optional[Dict]]:
    """
    Обрабатывает нажатие inline-кнопки.
    
    Returns:
        (текст ответа, keyboard или None)
    """
    if callback_data == "list_my":
        return cmd_list_my(username), get_main_menu_keyboard()
    
    if callback_data == "list_all":
        return cmd_list_all(), get_main_menu_keyboard()
    
    if callback_data == "close_task":
        _set_user_state(chat_id, "waiting_close_id")
        return cmd_close_task_prompt(), get_cancel_keyboard()
    
    if callback_data == "change_deadline":
        _set_user_state(chat_id, "waiting_deadline_id")
        return cmd_change_deadline_prompt(), get_cancel_keyboard()
    
    if callback_data == "cancel":
        _clear_user_state(chat_id)
        return "❌ Отменено.", get_main_menu_keyboard()
    
    return "❓ Неизвестная команда.", get_main_menu_keyboard()


# ======== ТЕКСТОВЫЕ СООБЩЕНИЯ ========

def handle_text_message(text: str, chat_id: int, username: str, author: str = "Telegram") -> Tuple[str, Optional[Dict]]:
    """
    Обрабатывает входящее текстовое сообщение.
    
    Returns:
        (текст ответа, keyboard или None)
    """
    text = text.strip()
    text_lower = text.lower()
    
    # Проверяем состояние пользователя (многошаговые команды)
    state = _get_user_state(chat_id)
    
    if state:
        if state["state"] == "waiting_close_id":
            # Пользователь ввёл номер для закрытия
            task_id = text.strip()
            _clear_user_state(chat_id)
            return do_close_task(task_id, username), get_main_menu_keyboard()
        
        if state["state"] == "waiting_deadline_id":
            # Пользователь ввёл номер для изменения срока
            _set_user_state(chat_id, "waiting_deadline_date", {"task_id": text.strip()})
            return (
                f"📅 Введите новый срок для поручения <b>#{text.strip()}</b>:\n\n"
                f"Например: <code>20.08.2026</code>, <code>завтра</code>, <code>15 августа</code>"
            ), get_cancel_keyboard()
        
        if state["state"] == "waiting_deadline_date":
            task_id = state["data"]["task_id"]
            _clear_user_state(chat_id)
            return do_change_deadline(task_id, text, username), get_main_menu_keyboard()
    
    # Стандартные команды
    if text_lower in ("/start", "/help", "help", "справка"):
        return get_welcome_text(username), get_main_menu_keyboard()
    
    if text_lower.startswith('/list'):
        return list_tasks_via_telegram(), get_main_menu_keyboard()
    
    if text_lower.startswith('/add'):
        _, data = parse_command(text)
        if data and data.get('description'):
            return add_task_via_telegram(data, author), get_main_menu_keyboard()
        else:
            return (
                "❌ Не удалось распознать поручение.\n\n"
                "Пример:\n"
                "/add проект \"Альфа\" описание \"Сделать отчёт\" ответственный \"Иванов\" срок 20.07.2026"
            ), get_main_menu_keyboard()
    
    # Пробуем распознать как естественный язык
    task = parse_task_from_text(text)
    if task:
        return add_task_via_telegram(task, author), get_main_menu_keyboard()
    
    # Если просто текст — показываем меню
    return get_welcome_text(username), get_main_menu_keyboard()


def get_welcome_text(username: str) -> str:
    """Приветственное сообщение с меню."""
    return (
        f"👋 <b>Привет!</b>\n\n"
        f"Я бот для управления реестром поручений.\n"
        f"Выберите действие:\n\n"
        f"📋 <b>Мои поручения</b> — ваши активные задачи\n"
        f"📋 <b>Все поручения</b> — полный список\n"
        f"✅ <b>Закрыть поручение</b> — отметить выполненным\n"
        f"📅 <b>Изменить срок</b> — перенести дедлайн"
    )


# ======== ПАРСИНГ ========

def parse_deadline(text: str) -> Optional[str]:
    text_lower = text.lower()
    
    patterns = [
        r'(\d{1,2})[./](\d{1,2})[./](\d{4})',
        r'(\d{1,2})[./](\d{1,2})[./](\d{2})',
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            d, m, y = match.groups()
            day, month, year = int(d), int(m), int(y)
            if year < 100:
                year += 2000
            return f"{day:02d}.{month:02d}.{year}"
    
    if 'сегодня' in text_lower:
        return datetime.now().strftime("%d.%m.%Y")
    if 'завтра' in text_lower:
        return (datetime.now() + timedelta(days=1)).strftime("%d.%m.%Y")
    if 'послезавтра' in text_lower:
        return (datetime.now() + timedelta(days=2)).strftime("%d.%m.%Y")
    
    months_ru = {
        'январ': 1, 'феврал': 2, 'март': 3, 'апрел': 4,
        'мая': 5, 'май': 5, 'июн': 6, 'июл': 7,
        'август': 8, 'сентябр': 9, 'октябр': 10,
        'ноябр': 11, 'декабр': 12
    }
    
    for month_name, month_num in months_ru.items():
        if month_name in text_lower:
            pattern = rf'(\d{{1,2}})\s*{month_name}'
            match = re.search(pattern, text_lower)
            if match:
                day = int(match.group(1))
                year = datetime.now().year
                if month_num < datetime.now().month:
                    year += 1
                return f"{day:02d}.{month_num:02d}.{year}"
    
    return None


def parse_task_from_text(text: str) -> Optional[Dict]:
    text_lower = text.lower()
    
    add_keywords = ['поручение', 'добавь', 'создай', 'новое', 'задач', '/add']
    if not any(kw in text_lower for kw in add_keywords):
        return None
    
    project = None
    project_patterns = [
        r'проект["\']?\s*[:\-]?\s*["\']?([^"\',\n]+)',
        r'проект\s+([\w\s]+?)(?:\s*,|\s+описание|\s+ответственный|\s+срок|$)',
    ]
    for pattern in project_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            project = match.group(1).strip()
            break
    
    description = None
    desc_patterns = [
        r'описание["\']?\s*[:\-]?\s*["\']?([^"\']+)',
        r'(?:сделать|подготовить|написать|создать|проверить)\s+(.+?)(?:\s*,|\s+ответственный|\s+срок|$)',
    ]
    for pattern in desc_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            description = match.group(1).strip()
            break
    
    if not description:
        for kw in ['поручение', 'задача']:
            if kw in text_lower:
                idx = text_lower.find(kw)
                rest = text[idx + len(kw):].strip(' :-')
                if len(rest) > 5:
                    description = rest.split(',')[0].strip()
                    break
    
    assignee = None
    assignee_patterns = [
        r'ответственный["\']?\s*[:\-]?\s*["\']?([^"\',\n]+)',
        r'ответственный\s+([\w\s\.]+?)(?:\s*,|\s+срок|$)',
        r'(?:за|на)\s+([\w\s\.]+?)(?:\s*,|\s+срок|$)',
    ]
    for pattern in assignee_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            assignee = match.group(1).strip()
            break
    
    deadline = parse_deadline(text)
    
    if not assignee:
        fio_pattern = r'([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)'
        match = re.search(fio_pattern, text)
        if match:
            assignee = match.group(1).strip()
        else:
            initials_pattern = r'([А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.[А-ЯЁ]\.)'
            match = re.search(initials_pattern, text)
            if match:
                assignee = match.group(1).strip()
            else:
                name_after = r'(?:ответственный|исполнитель|кто|за)\s+([А-ЯЁ][а-яё]+)'
                match = re.search(name_after, text, re.IGNORECASE)
                if match:
                    assignee = match.group(1).strip()
    
    if not description:
        return None
    
    return {
        'project': project or 'Без проекта',
        'description': description,
        'assignee': assignee or 'Не назначен',
        'deadline': deadline or (datetime.now() + timedelta(days=7)).strftime("%d.%m.%Y"),
    }


def parse_command(text: str) -> Tuple[str, Optional[Dict]]:
    text = text.strip()
    text_lower = text.lower()
    
    if text_lower.startswith('/add'):
        rest = text[4:].strip()
        params = {}
        
        m = re.search(r'проект["\']?\s*[:\-]?\s*["\']?([^"\',\n]+)', rest, re.IGNORECASE)
        if m:
            params['project'] = m.group(1).strip()
        
        m = re.search(r'описание["\']?\s*[:\-]?\s*["\']?([^"\']+)', rest, re.IGNORECASE)
        if m:
            params['description'] = m.group(1).strip()
        
        m = re.search(r'ответственный["\']?\s*[:\-]?\s*["\']?([^"\',\n]+)', rest, re.IGNORECASE)
        if m:
            params['assignee'] = m.group(1).strip()
        
        params['deadline'] = parse_deadline(rest)
        
        if not params.get('description'):
            parts = [p.strip() for p in rest.split(',')]
            if len(parts) >= 1:
                params['project'] = parts[0]
            if len(parts) >= 2:
                params['description'] = parts[1]
            if len(parts) >= 3:
                params['assignee'] = parts[2]
            if len(parts) >= 4:
                params['deadline'] = parse_deadline(parts[3]) or parts[3]
        
        return 'add', params if params.get('description') else None
    
    if text_lower.startswith('/list'):
        return 'list', None
    
    if text_lower.startswith('/help'):
        return 'help', None
    
    task = parse_task_from_text(text)
    if task:
        return 'add', task
    
    return 'unknown', None


# ======== ДЕЙСТВИЯ ========

def add_task_via_telegram(data: Dict, author: str = "Telegram") -> str:
    import subprocess
    
    cmd = [
        sys.executable,
        os.path.join(SCRIPT_DIR, 'task_manager.py'),
        'add',
        '--author', author,
        '--project', data.get('project', 'Без проекта'),
        '--description', data['description'],
        '--assignee', data.get('assignee', 'Не назначен'),
        '--deadline', data.get('deadline', datetime.now().strftime("%d.%m.%Y")),
    ]
    
    env = os.environ.copy()
    env['PYTHONIOENCODING'] = 'utf-8'
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            env=env,
            cwd=SKILL_DIR,
            timeout=30
        )
        
        if result.returncode == 0:
            return (
                f"✅ Поручение добавлено!\n\n"
                f"📁 Проект: {data.get('project', 'Без проекта')}\n"
                f"📝 {data['description']}\n"
                f"👤 {data.get('assignee', 'Не назначен')}\n"
                f"📅 Срок: {data.get('deadline', 'Не указан')}"
            )
        else:
            return f"❌ Ошибка при добавлении:\n{result.stderr}"
    except Exception as e:
        return f"❌ Ошибка: {e}"


def list_tasks_via_telegram() -> str:
    import subprocess
    
    cmd = [
        sys.executable,
        os.path.join(SCRIPT_DIR, 'task_manager.py'),
        'list',
    ]
    
    env = os.environ.copy()
    env['PYTHONIOENCODING'] = 'utf-8'
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            env=env,
            cwd=SKILL_DIR,
            timeout=30
        )
        
        if result.returncode == 0:
            output = result.stdout
            output = output.replace('📋 Найдено поручений:', '*Активные поручения:*')
            output = output.replace('-' * 100, '')
            return output
        else:
            return f"❌ Ошибка:\n{result.stderr}"
    except Exception as e:
        return f"❌ Ошибка: {e}"


# ======== ГОЛОСОВЫЕ СООБЩЕНИЯ ========

def download_voice_file(file_id: str, bot_token: str) -> Optional[str]:
    import requests
    
    url = f"https://api.telegram.org/bot{bot_token}/getFile"
    resp = requests.get(url, params={'file_id': file_id}, timeout=30)
    
    if resp.status_code != 200:
        return None
    
    data = resp.json()
    if not data.get('ok'):
        return None
    
    file_path = data['result']['file_path']
    download_url = f"https://api.telegram.org/file/bot{bot_token}/{file_path}"
    file_resp = requests.get(download_url, timeout=60)
    
    if file_resp.status_code != 200:
        return None
    
    temp_dir = os.path.join(SKILL_DIR, '.temp')
    os.makedirs(temp_dir, exist_ok=True)
    
    ext = '.oga' if file_path.endswith('.oga') else '.ogg'
    local_path = os.path.join(temp_dir, f"voice_{file_id}{ext}")
    
    with open(local_path, 'wb') as f:
        f.write(file_resp.content)
    
    return local_path


def transcribe_audio_yandex(audio_path: str, api_key: Optional[str] = None) -> Optional[str]:
    import requests
    
    if api_key is None:
        api_key = os.environ.get('YANDEX_API_KEY')
    
    if not api_key:
        return None
    
    url = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize"
    headers = {'Authorization': f'Api-Key {api_key}'}
    params = {'lang': 'ru-RU', 'format': 'oggopus', 'sampleRateHertz': '48000'}
    
    try:
        with open(audio_path, 'rb') as f:
            resp = requests.post(url, headers=headers, params=params, data=f, timeout=120)
        
        if resp.status_code == 200:
            return resp.json().get('result')
        else:
            print(f"Yandex STT error: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"Yandex STT exception: {e}")
        return None


def handle_voice_message(file_id: str, bot_token: str, api_key: Optional[str] = None) -> str:
    audio_path = download_voice_file(file_id, bot_token)
    if not audio_path:
        return "❌ Не удалось скачать голосовое сообщение."
    
    try:
        if not api_key and not os.environ.get('YANDEX_API_KEY'):
            return (
                "🎤 Голосовое сообщение получено, но распознавание не настроено.\n\n"
                "Добавь Yandex API-ключ в конфиг:\n"
                "  openclaw config set env.vars.YANDEX_API_KEY \"AQVN...\""
            )
        
        text = transcribe_audio_yandex(audio_path, api_key)
        
        if not text:
            return "❌ Не удалось распознать голосовое сообщение. Попробуйте отправить текст."
        
        result = handle_text_message(text, 0, "Telegram (voice)")
        return f"🎤 *Распознано:* {text}\n\n{result[0]}"
    finally:
        try:
            os.remove(audio_path)
        except OSError:
            pass


# ======== ОБРАТНАЯ СОВМЕСТИМОСТЬ ========

def handle_telegram_message(text: str, author: str = "Telegram") -> str:
    """Старый интерфейс для обратной совместимости."""
    result, _ = handle_text_message(text, 0, author)
    return result


def format_help() -> str:
    return get_welcome_text("")


# Для тестирования
if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1:
        text = ' '.join(sys.argv[1:])
        r, k = handle_text_message(text, 0, "test")
        print(r)
    else:
        print(get_welcome_text(""))
