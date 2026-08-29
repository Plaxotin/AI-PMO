#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Бот @Plaxotin_task_bot — «Администратор поручений», v3.1.

Модель v3.0:
  - Групповой чат: бот НЕ реагирует на сообщения. Группа получает только
    автоматические рассылки (утренний дайджест дедлайнов через check-deadlines,
    вечерний дайджест изменений в 20:47 МСК). Исключение (v3.1): команды
    /идея и /баг — сбор фидбека во вкладку «Бэклог BL-6» с подтверждением.
  - Личка — для всех: обычным пользователям приветствие + inline-кнопки
    «📋 Мои поручения» (закрытие в один тап), «📂 Открыть реестр»,
    «📋 Выбрать реестр».
  - Админы: ТОЛЬКО свободная форма через LLM (канонические
    команды полностью отключены).
  - Два реестра с возможностью переключения через inline-кнопки.

Сохранено из v2.2: роли, антифлуд, аудит-лог, кэш TTL 60 с,
умные даты, защита от дублей, версии конфигурации.
"""

import html
import json
import re
import os
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import commands
import feedback
import llm

# ======== ПУТИ ========
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.join(SCRIPT_DIR, '..')
CREDS_DIR = os.path.join(SKILL_DIR, '.credentials')
CONFIG_PATH = os.path.join(CREDS_DIR, 'config.json')
TELEGRAM_CONFIG = os.path.join(CREDS_DIR, 'telegram.json')
USER_MAPPING_PATH = os.path.join(CREDS_DIR, 'user_mapping.json')
ADMIN_CHATS_PATH = os.path.join(CREDS_DIR, 'admin_chats.json')
VERSIONS_DIR = os.path.join(SKILL_DIR, 'versions')

BOT_USERNAME = "Plaxotin_task_bot"
MSK = timezone(timedelta(hours=3))  # сервер в UTC, пользователи в МСК

TASK_HEADERS = ["ID", "Дата создания", "Автор/Источник", "Контрагент", "Описание",
                "Ответственный", "Срок", "Статус", "Дата закрытия", "Комментарий"]

try:
    import requests
except ImportError:
    print("Установите requests: pip install requests")
    sys.exit(1)


def now_msk() -> datetime:
    return datetime.now(timezone.utc).astimezone(MSK)


def log(msg: str):
    print(f"[{now_msk().strftime('%d.%m.%Y %H:%M:%S')}] {msg}", flush=True)


# ======== КОНФИГ ========

DEFAULT_LIMITS = {"per_min": 10, "per_day": 100, "admin_per_day": 1000, "global_day": 500}


def load_config() -> Dict:
    cfg = {}
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
        except Exception as e:
            log(f"⚠️ Ошибка чтения config.json: {e}")
    cfg.setdefault("admins", [])
    cfg.setdefault("admin_ids", [])
    limits = dict(DEFAULT_LIMITS)
    limits.update(cfg.get("limits") or {})
    cfg["limits"] = limits
    cfg.setdefault("digest_time", "20:47")
    cfg.setdefault("registries", [])
    return cfg


def save_config(cfg: Dict):
    os.makedirs(CREDS_DIR, exist_ok=True)
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def resolve_role(username: str, cfg: Dict, user_id=None) -> str:
    """Роль по Telegram username (регистронезависимо) или по user_id
    (список admin_ids в конфиге — для пользователей без логина)."""
    uname = (username or "").lstrip('@').lower()
    if uname and uname in [str(a).lower() for a in cfg.get("admins", [])]:
        return "admin"
    if user_id is not None:
        try:
            if int(user_id) in [int(a) for a in cfg.get("admin_ids", [])]:
                return "admin"
        except (TypeError, ValueError):
            pass
    return "user"


def registry_link() -> str:
    sid = get_active_registry().get('id', '')
    return f"https://docs.google.com/spreadsheets/d/{sid}/edit"


def get_active_registry() -> Dict:
    """Возвращает активный реестр из конфига."""
    cfg = load_config()
    for r in cfg.get('registries', []):
        if r.get('active'):
            return r
    # fallback на старую схему
    return {"id": cfg.get('spreadsheet_id', ''), "name": "Реестр"}


def with_footer(text: str) -> str:
    """Добавляет футер со ссылкой на реестр."""
    return f"{text}\n\n📋 Реестр: {registry_link()}"


# ======== TELEGRAM API (как в v1.0) ========

def load_telegram_config() -> Dict:
    with open(TELEGRAM_CONFIG, 'r', encoding='utf-8') as f:
        return json.load(f)


def tg_api(method: str, params: Dict = None) -> Dict:
    """Вызов метода Telegram Bot API."""
    config = load_telegram_config()
    url = f"https://api.telegram.org/bot{config['bot_token']}/{method}"
    poll = (params or {}).get('timeout', 0)
    req_timeout = (10, poll + 15) if poll else 30
    try:
        resp = requests.post(url, json=params or {}, timeout=req_timeout)
        return resp.json()
    except Exception as e:
        log(f"Ошибка API ({method}): {e}")
        return {"ok": False}


def _split_message(message: str, max_len: int = 3800) -> List[str]:
    """Разбивает длинное сообщение на части по границам строк."""
    if len(message) <= max_len:
        return [message]
    parts, current = [], ""
    for line in message.split('\n'):
        if len(current) + len(line) + 1 > max_len:
            if current:
                parts.append(current)
            current = line
        else:
            current = current + '\n' + line if current else line
    if current:
        parts.append(current)
    return parts or [message]


def send_message(chat_id, text: str, reply_to: int = None,
                 reply_markup: Dict = None) -> bool:
    """Отправляет сообщение (длинное — частями), опционально с inline-кнопками."""
    parts = _split_message(text)
    ok = True
    for i, part in enumerate(parts):
        payload = {'chat_id': chat_id, 'text': part, 'parse_mode': 'HTML',
                   'disable_web_page_preview': True}
        if reply_to:
            payload['reply_to_message_id'] = reply_to
        # кнопки вешаем на последнюю часть
        if reply_markup and i == len(parts) - 1:
            payload['reply_markup'] = reply_markup
        ok = tg_api('sendMessage', payload).get('ok', False) and ok
    return ok


def edit_message(chat_id, message_id: int, text: str,
                 reply_markup: Dict = None) -> bool:
    """Редактирует существующее сообщение."""
    payload = {'chat_id': chat_id, 'message_id': message_id, 'text': text,
               'parse_mode': 'HTML', 'disable_web_page_preview': True}
    if reply_markup:
        payload['reply_markup'] = reply_markup
    return tg_api('editMessageText', payload).get('ok', False)


def answer_callback_query(callback_query_id: str, text: str = None):
    """Подтверждает обработку callback query (убирает часики на кнопке)."""
    payload = {'callback_query_id': callback_query_id}
    if text:
        payload['text'] = text
    tg_api('answerCallbackQuery', payload)


# ======== INLINE-КЛАВИАТУРЫ ========

def main_keyboard(role: str = "user") -> Dict:
    kb = [
        [{"text": "📋 Мои поручения", "callback_data": "my_tasks"}, {"text": "📊 Отправить дайджест", "callback_data": "send_digest"}],
        [{"text": "📂 Открыть реестр", "url": registry_link()}],
        [{"text": "📋 Выбрать реестр", "callback_data": "select_registry"}],
    ]
    if role == "admin":
        kb.append([{"text": "📝 Редактировать реестр", "callback_data": "admin_mode"}])
    return {"inline_keyboard": kb}


def reply_main_keyboard(role: str = "user", admin_mode: bool = False) -> Dict:
    """Reply-клавиатура (постоянные кнопки под полем ввода)."""
    rows = []
    rows.append([{"text": "📋 Мои поручения"}])
    if role == "admin":
        if admin_mode:
            rows.append([{"text": "❌ Выйти"}])
        else:
            rows.append([{"text": "📝 Редактировать"},
                         {"text": "🔍 Проверить"}])
            rows.append([{"text": "📊 Дайджест"},
                         {"text": "📋 Реестры"}])
    return {"keyboard": rows, "resize_keyboard": True}


def admin_mode_keyboard() -> Dict:
    return {"keyboard": [[{"text": "❌ Выйти"}]], "resize_keyboard": True}


def confirm_keyboard() -> Dict:
    return {"keyboard": [[{"text": "✅ Да"}, {"text": "❌ Нет"}]], "resize_keyboard": True}


# ======== АНТИФЛУД ========

class FloodControl:
    def __init__(self):
        self._minute: Dict[str, Dict] = {}
        self._day: Dict[str, Dict] = {}
        self._global = {"date": "", "count": 0, "warned": False}

    def check(self, user_id: int, role: str, limits: Dict) -> Tuple[bool, Optional[str]]:
        uid = str(user_id)
        now = time.time()
        today = now_msk().strftime("%d.%m.%Y")

        if self._global["date"] != today:
            self._global = {"date": today, "count": 0, "warned": False}
        if self._global["count"] >= limits["global_day"]:
            warn = None
            if not self._global["warned"]:
                self._global["warned"] = True
                warn = "⚠️ Бот сегодня перегружен (глобальный лимит команд). Попробуйте завтра."
            return False, warn
        self._global["count"] += 1

        day_limit = limits["admin_per_day"] if role == "admin" else limits["per_day"]
        d = self._day.get(uid)
        if not d or d["date"] != today:
            d = {"date": today, "count": 0, "warned": False}
            self._day[uid] = d
        if d["count"] >= day_limit:
            warn = None
            if not d["warned"]:
                d["warned"] = True
                warn = (f"⚠️ Вы исчерпали дневной лимит команд ({day_limit}). "
                        f"До конца дня команды будут игнорироваться.")
            return False, warn
        d["count"] += 1

        if role != "admin":
            m = self._minute.get(uid)
            if not m or now - m["window_start"] >= 60:
                m = {"window_start": now, "count": 0, "warned": False}
                self._minute[uid] = m
            if m["count"] >= limits["per_min"]:
                warn = None
                if not m["warned"]:
                    m["warned"] = True
                    warn = (f"⚠️ Слишком много команд (лимит {limits['per_min']}/мин). "
                            f"Подождите минуту.")
                return False, warn
            m["count"] += 1

        return True, None


flood = FloodControl()


# ======== КЭШ РЕЕСТРА ========

_CACHE_TTL = 60
_tasks_cache: Dict = {"ts": 0.0, "data": []}


def invalidate_cache():
    _tasks_cache["ts"] = 0.0


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


def get_all_tasks(force: bool = False) -> List[Dict]:
    if not force and time.time() - _tasks_cache["ts"] < _CACHE_TTL:
        return _tasks_cache["data"]

    success, output = run_task_manager('list', '--json')
    tasks: List[Dict] = []
    if success:
        try:
            tasks = json.loads(output.strip())
        except json.JSONDecodeError:
            success = False

    if not success:
        success2, output2 = run_task_manager('list')
        if not success2:
            return _tasks_cache["data"]
        tasks = []
        for line in output2.split('\n'):
            line = line.strip()
            if not line or line.startswith('Найдено') or line.startswith('ID') or line.startswith('-'):
                continue
            parts = line.split(None, 5)
            if len(parts) >= 5:
                tasks.append({
                    'id': parts[0],
                    'status': parts[1],
                    'deadline': parts[2],
                    'contragent': parts[3],
                    'assignee': parts[4],
                    'description': parts[5] if len(parts) > 5 else ''
                })
    _tasks_cache["ts"] = time.time()
    _tasks_cache["data"] = tasks
    return tasks


def get_task_info(task_id: int) -> Optional[Dict]:
    for task in get_all_tasks():
        if task['id'] == str(task_id):
            return task
    return None


def load_user_mapping() -> Dict[str, str]:
    if not os.path.exists(USER_MAPPING_PATH):
        return {}
    try:
        with open(USER_MAPPING_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def save_user_mapping(mapping: Dict[str, str]):
    try:
        with open(USER_MAPPING_PATH, 'w', encoding='utf-8') as f:
            json.dump(mapping, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f"⚠️ Ошибка сохранения user_mapping: {e}")


def update_task_fields_in_sheet(task_id: str, fields: Dict[str, str]) -> bool:
    """Обновляет поля задачи в Google Sheets.
    fields: {'срок': '...', 'описание': '...', 'контрагент': '...'}
    Колонки ищутся по заголовкам (порядок не важен). Возвращает True при успехе."""
    # Синонимы — дубль COLUMN_SYNONYMS из task_manager.py, держать синхронно
    field_headers = {
        'срок': ["срок", "srok", "srok korr", "srok plan"],
        'описание': ["описание", "opisanie"],
        'контрагент': ["контрагент", "компания", "ка"],
    }
    try:
        spreadsheet = _get_spreadsheet()
        ws = spreadsheet.sheet1
        headers = [h.strip().lower() for h in ws.row_values(1)]

        def find_col(names):
            for n in names:
                if n in headers:
                    return headers.index(n) + 1  # 1-based
            return None

        values = ws.get_all_values()
        id_col = find_col(["id", "№"])
        row_idx = None
        for i, row in enumerate(values[1:], start=2):
            if id_col and len(row) >= id_col and row[id_col - 1].strip() == str(task_id):
                row_idx = i
                break
        if not row_idx:
            log(f"⚠️ Задача {task_id} не найдена в таблице")
            return False

        for field_name, value in fields.items():
            col = find_col(field_headers.get(field_name.lower(), []))
            if col:
                ws.update_cell(row_idx, col, value)
                log(f"📝 Обновлено: задача {task_id}, {field_name} = {value}")
        return True
    except Exception as e:
        log(f"⚠️ Ошибка обновления задачи {task_id}: {e}")
        return False



def load_contacts_from_registry() -> Dict[str, str]:
    """Читает вкладку «Контакты» из активного реестра.
    Возвращает {имя_нижний_регистр: @логин}."""
    try:
        spreadsheet = _get_spreadsheet()
        ws = spreadsheet.worksheet('Контакты')
        rows = ws.get_all_values()
        contacts = {}
        for row in rows[1:]:  # пропускаем заголовок
            if len(row) >= 2:
                name = row[0].strip()
                tg = row[1].strip()
                if name and tg:
                    contacts[name.lower()] = tg
        return contacts
    except Exception:
        return {}



def get_assignee_by_telegram(username: str, user_id=None) -> Optional[str]:
    mapping = load_user_mapping()
    username_clean = (username or "").lstrip('@').lower()
    for name, tg in mapping.items():
        val = str(tg).lstrip('@').lower()
        if username_clean and val == username_clean:
            return name
        if user_id is not None and val == f"id:{user_id}":
            return name
    return None


# ======== АУДИТ-ЛОГ ========

AUDIT_SHEET = "Лог"
AUDIT_HEADERS = ["Дата/время", "Telegram user", "Действие", "ID поручения", "Детали"]


def _gsheets_client():
    import gspread
    from google.oauth2.service_account import Credentials

    creds_file = os.path.join(CREDS_DIR, 'gsheets-service-account.json')
    scopes = ['https://www.googleapis.com/auth/spreadsheets',
              'https://www.googleapis.com/auth/drive']
    creds = Credentials.from_service_account_file(creds_file, scopes=scopes)
    return gspread.authorize(creds)


def _get_spreadsheet():
    client = _gsheets_client()
    spreadsheet_id = get_active_registry().get('id')
    return client.open_by_key(spreadsheet_id)


def _get_audit_sheet():
    spreadsheet = _get_spreadsheet()
    try:
        ws = spreadsheet.worksheet(AUDIT_SHEET)
    except Exception:
        ws = spreadsheet.add_worksheet(title=AUDIT_SHEET, rows=1000, cols=len(AUDIT_HEADERS))
        ws.update(range_name='A1:E1', values=[AUDIT_HEADERS])
        ws.format('A1:E1', {'textFormat': {'bold': True},
                            'backgroundColor': {'red': 0.9, 'green': 0.9, 'blue': 0.9}})
        log(f"Создан лист «{AUDIT_SHEET}» для аудит-лога")
    return ws


def audit(action: str, task_id, details: str, username: str):
    try:
        ws = _get_audit_sheet()
        ws.append_row([
            now_msk().strftime("%d.%m.%Y %H:%M:%S"),
            f"@{username}" if username else "?",
            action,
            str(task_id),
            details,
        ])
    except Exception as e:
        log(f"⚠️ Не удалось записать аудит-лог: {e}")


def read_audit_entries() -> List[List[str]]:
    try:
        ws = _get_audit_sheet()
        values = ws.get_all_values()
        return values[1:] if len(values) > 1 else []
    except Exception as e:
        log(f"⚠️ Не удалось прочитать аудит-лог: {e}")
        return []


def find_recent_duplicate(project: str, description: str, minutes: int = 10) -> Optional[List[str]]:
    cutoff = now_msk() - timedelta(minutes=minutes)
    for row in reversed(read_audit_entries()):
        if len(row) < 5 or row[2] != "create":
            continue
        try:
            ts = datetime.strptime(row[0], "%d.%m.%Y %H:%M:%S").replace(tzinfo=MSK)
        except ValueError:
            continue
        if ts < cutoff:
            break
        parts = dict(p.split("=", 1) for p in (row[4] or "").split(" | ") if "=" in p)
        if (parts.get("Контрагент", parts.get("Проект", "")).strip().lower() == project.strip().lower()
                and parts.get("Описание", "").strip().lower() == description.strip().lower()):
            return row
    return None


# ======== ЧАТЫ АДМИНОВ ========

def remember_admin_chat(username: str, chat_id, user_id=None):
    if not username and user_id is None:
        return
    username = username or f"id:{user_id}"
    data = {}
    if os.path.exists(ADMIN_CHATS_PATH):
        try:
            with open(ADMIN_CHATS_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            data = {}
    uname = username.lstrip('@').lower()
    if data.get(uname) != chat_id:
        data[uname] = chat_id
        try:
            with open(ADMIN_CHATS_PATH, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log(f"⚠️ Не удалось сохранить admin_chats.json: {e}")


def get_admin_chat_ids(cfg: Dict) -> List[int]:
    try:
        with open(ADMIN_CHATS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        data = {}
    usernames = {str(a).lower() for a in cfg.get("admins", [])}
    usernames.update(f"id:{a}" for a in cfg.get("admin_ids", []))
    chat_ids = []
    for uname in usernames:
        cid = data.get(uname)
        if cid and cid not in chat_ids:
            chat_ids.append(cid)
    return chat_ids


def get_group_chat_id() -> Optional[int]:
    try:
        return load_telegram_config().get('chat_id')
    except Exception:
        return None


# ======== СОСТОЯНИЯ ========
_user_states: Dict[str, Dict] = {}
CONFIRM_TIMEOUT = 600
USER_STATES_PATH = os.path.join(CREDS_DIR, 'user_states.json')


def _state_key(chat_id, user_id) -> str:
    return f"{chat_id}:{user_id}"


def load_user_states():
    global _user_states
    if os.path.exists(USER_STATES_PATH):
        try:
            with open(USER_STATES_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            now = time.time()
            _user_states = {k: v for k, v in data.items() if now - v.get('ts', 0) < CONFIRM_TIMEOUT}
            log(f"🔄 Загружено {len(_user_states)} активных состояний пользователей")
        except Exception as e:
            log(f"⚠️ Ошибка загрузки user_states: {e}")
            _user_states = {}


def save_user_states():
    try:
        with open(USER_STATES_PATH, 'w', encoding='utf-8') as f:
            json.dump(_user_states, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f"⚠️ Ошибка сохранения user_states: {e}")


def _set_user_state(key: str, state: str, data: Dict = None):
    _user_states[key] = {"state": state, "data": data or {}, "ts": time.time()}
    save_user_states()


def _get_user_state(key: str) -> Optional[Dict]:
    st = _user_states.get(key)
    if st and time.time() - st.get("ts", 0) > CONFIRM_TIMEOUT:
        _user_states.pop(key, None)
        save_user_states()
        return None
    return st


def _clear_user_state(key: str):
    _user_states.pop(key, None)
    save_user_states()


# ======== ФОРМАТИРОВАНИЕ ========
_STATUS_EMOJI = {
    "Новое": "🆕", "В работе": "🔵", "На проверке": "🟡",
    "Выполнено": "✅", "Отменено": "❌", "Просрочено": "🔴",
}


def format_task_list(tasks: List[Dict], title: str) -> str:
    if not tasks:
        return f"📭 {title}\n\nПоручений не найдено."

    lines = [f"<b>{title}</b> ({len(tasks)} шт.)\n"]
    for task in tasks:
        status_emoji = _STATUS_EMOJI.get(task.get('status', ''), "⚪")
        lines.append(
            f"<b>#{task.get('id', '?')}</b> {status_emoji} <b>{task.get('status', '?')}</b>  "
            f"📅 {task.get('deadline', '?')}\n"
            f"   📝 {html.escape(task.get('description', ''))}\n"
            f"   📁 {html.escape(task.get('contragent') or 'Без контрагента')}  "
            f"👤 {html.escape(task.get('assignee', '?'))}  "
            f"📣 {html.escape(task.get('author') or '?')}\n"
        )
    return "\n".join(lines)


# ======== КНОПОЧНЫЙ СЦЕНАРИЙ ========

def get_open_tasks_for(username: str, user_id=None) -> Tuple[Optional[str], List[Dict]]:
    mapping = load_user_mapping()
    username_clean = (username or "").lstrip('@').lower()
    assignee_names = [name for name, tg in mapping.items()
                      if (username_clean and str(tg).lstrip('@').lower() == username_clean)
                      or (user_id is not None and str(tg).lstrip('@').lower() == f"id:{user_id}")]
    if not assignee_names:
        return None, []
    tasks = []
    for t in get_all_tasks():
        if t.get('status') in ("Выполнено", "Отменено"):
            continue
        task_assignees = t.get('assignee', '').lower()
        if any(name.lower() in task_assignees for name in assignee_names):
            tasks.append(t)
    display_name = min(assignee_names, key=len)
    return display_name, tasks


def build_my_tasks_view(username: str, user_id=None) -> Tuple[str, Optional[Dict]]:
    assignee, tasks = get_open_tasks_for(username, user_id)
    if not assignee:
        return ("❓ Вы не найдены в реестре.\n"
                "Обратитесь к администратору, чтобы добавить ваш Telegram "
                "в user_mapping.json."), None
    if not tasks:
        return with_footer(f"📭 У вас нет открытых поручений ({html.escape(assignee)}). 🎉"), None

    buttons = []
    for t in tasks:
        desc = t.get('description', '')
        desc_short = desc[:40] + "…" if len(desc) > 40 else desc
        buttons.append([{"text": f"✅ #{t['id']} {desc_short}",
                         "callback_data": f"close:{t['id']}"}])
    buttons.append([{"text": "🔄 Обновить", "callback_data": "refresh"}])

    blocks = []
    for t in tasks:
        status_emoji = _STATUS_EMOJI.get(t.get('status', ''), "⚪")
        blocks.append(
            f"<b>#{t.get('id', '?')}</b> {status_emoji} <b>{t.get('status', '?')}</b>  "
            f"📅 {t.get('deadline', '?')}\n"
            f"📝 {html.escape(t.get('description', ''))}\n"
            f"📁 {html.escape(t.get('contragent') or 'Без контрагента')}  "
            f"📣 {html.escape(t.get('author') or '?')}"
        )
    text = with_footer(
        f"📋 <b>Ваши открытые поручения</b> ({len(tasks)}) — {html.escape(assignee)}\n\n"
        + "\n\n".join(blocks)
        + "\n\nНажмите на поручение ниже, чтобы закрыть его."
    )
    return text, {"inline_keyboard": buttons}


def build_registry_selector() -> Tuple[str, Optional[Dict]]:
    """Строит список реестров с кнопками переключения."""
    cfg = load_config()
    registries = cfg.get('registries', [])
    lines = ["<b>📋 Доступные реестры:</b>\n"]
    buttons = []
    for r in registries:
        mark = " ✅" if r.get('active') else ""
        lines.append(f"• {html.escape(r.get('name', 'Без названия'))}{mark}")
        if True:
            buttons.append([{"text": f"📋 {r.get('name')}",
                             "callback_data": f"switch_registry:{r.get('name')}"}])
    return "\n".join(lines), {"inline_keyboard": buttons}


def handle_close_callback(task_id: int, username: str, user_id=None) -> Tuple[str, bool]:
    assignee = get_assignee_by_telegram(username, user_id)
    if not assignee:
        return "❌ Вы не найдены в реестре, обратитесь к администратору.", False

    task = get_task_info(task_id)
    if not task:
        return f"❌ Поручение #{task_id} не найдено (уже удалено?).", False

    task_assignees_raw = task.get('assignee', '').strip()
    if not task_assignees_raw:
        return f"❌ У поручения #{task_id} не указан ответственный.", False
    task_assignees = [a.strip() for a in task_assignees_raw.split(',')]

    # Проверка 1: имя из user_mapping совпадает с ответственным в реестре
    is_match = any(assignee.lower() == ta.lower() for ta in task_assignees)
    # Проверка 2: Telegram username пользователя совпадает с ответственным (если в реестре записан логин)
    user_clean = username.lstrip('@').lower()
    if not is_match:
        is_match = any(user_clean == ta.lstrip('@').lower() for ta in task_assignees)
    # Проверка 3: имя ответственного из реестра замаплено на текущего пользователя
    if not is_match:
        mapping = load_user_mapping()
        for ta in task_assignees:
            mv = str(mapping.get(ta, "")).lstrip('@').lower()
            if (user_clean and mv == user_clean) or \
               (user_id is not None and mv == f"id:{user_id}"):
                is_match = True
                break

    if not is_match:
        log(f"⚠️ @{username} попытался закрыть чужое поручение #{task_id} "
            f"(ответственный: {task_assignees_raw})")
        return f"❌ #{task_id} — не ваше поручение ({task_assignees_raw}).", False

    if task.get('status') in ("Выполнено", "Отменено"):
        return f"ℹ️ Поручение #{task_id} уже закрыто.", False

    success, output = run_task_manager('update', str(task_id), '--status', 'Выполнено')
    if success:
        invalidate_cache()
        audit("close", task_id, f"Статус → Выполнено ({assignee}) [кнопка]", username)
        return f"✅ Поручение #{task_id} закрыто!", True
    log(f"⚠️ Ошибка закрытия #{task_id}: {output[:200]}")
    return f"❌ Не удалось закрыть #{task_id}.", False


# ======== ОБРАБОТЧИКИ КОМАНД ========

def cmd_list_my(username: str, user_id=None) -> str:
    assignee = get_assignee_by_telegram(username, user_id)
    if not assignee:
        return ("❓ Не удалось определить ваше имя в реестре.\n"
                "Обратитесь к администратору (user_mapping.json).")
    assignee_l, filtered = get_open_tasks_for(username, user_id)
    return with_footer(format_task_list(filtered, f"📋 Мои поручения — {assignee}"))


def cmd_list_all() -> str:
    return with_footer(format_task_list(get_all_tasks(), "📋 Все поручения"))


def cmd_list_project(project: str) -> str:
    filtered = [t for t in get_all_tasks()
                if project.lower() in t.get('contragent', '').lower()]
    return with_footer(format_task_list(filtered, f"📋 Поручения контрагента «{project}»"))


def cmd_list_status(status: str) -> str:
    filtered = [t for t in get_all_tasks()
                if status.lower() in t.get('status', '').lower()]
    return with_footer(format_task_list(filtered, f"📋 Поручения со статусом «{status}»"))


def cmd_close_task(task_id: int, username: str, user_id=None) -> str:
    toast, success = handle_close_callback(task_id, username, user_id)
    if success:
        return with_footer(toast)
    return toast


def cmd_create_preview(args: Dict, username: str) -> str:
    return with_footer(
        "📝 <b>Проверьте новое поручение:</b>\n\n"
        f"   📁 Контрагент: {html.escape(args['contragent'])}\n"
        f"   📝 Описание: {html.escape(args['description'])}\n"
        f"   👤 Ответственный: {html.escape(args['assignee'])}\n"
        f"   📅 Срок: <b>{args['deadline']}</b>\n"
        f"   ✍️ Автор: @{html.escape(username or '?')}\n\n"
        f"Напишите <b>да</b> для подтверждения (60 сек), любой другой текст — отмена."
    )


def cmd_create_execute(args: Dict, username: str, first_name: str) -> str:
    author = f"{first_name} (@{username})" if username else first_name
    success, output = run_task_manager(
        'add',
        '--author', author,
        '--contragent', args['contragent'],
        '--description', args['description'],
        '--assignee', args['assignee'],
        '--deadline', args['deadline'],
        '--status', 'Новое',
    )
    if success:
        invalidate_cache()
        new_id = ""
        for token in output.split():
            if token.startswith('#') and token[1:].isdigit():
                new_id = token[1:]
        audit("create", new_id or "?",
              f"Контрагент={args['contragent']} | Описание={args['description']} | "
              f"Ответственный={args['assignee']} | Срок={args['deadline']}",
              username)
        return with_footer(
            f"✅ Поручение <b>#{new_id or '?'}</b> создано!\n\n"
            f"   📁 {html.escape(args['contragent'])}\n"
            f"   📝 {html.escape(args['description'])}\n"
            f"   👤 {html.escape(args['assignee'])}  📅 {args['deadline']}")
    return f"❌ Не удалось создать поручение.\n<code>{html.escape(output[:300])}</code>"


def _cmd_update(task_id: int, flag: str, value: str, action_label: str,
                username: str, audit_details: str) -> str:
    task = get_task_info(task_id)
    if not task:
        return f"❌ Поручение <b>#{task_id}</b> не найдено."
    success, output = run_task_manager('update', str(task_id), flag, value)
    if success:
        invalidate_cache()
        audit("update", task_id, audit_details, username)
        return with_footer(
            f"✅ Поручение <b>#{task_id}</b>: {action_label}.\n\n"
            f"   📝 {html.escape(task.get('description', ''))}")
    return f"❌ Не удалось обновить #{task_id}.\n<code>{html.escape(output[:200])}</code>"


def cmd_delete_execute(task_id: int, username: str) -> str:
    task = get_task_info(task_id)
    success, output = run_task_manager('delete', str(task_id))
    if success:
        invalidate_cache()
        desc = task.get('description', '') if task else ''
        audit("delete", task_id, f"Удалено: {desc[:100]}", username)
        return with_footer(f"🗑 Поручение <b>#{task_id}</b> удалено.")
    return f"❌ Не удалось удалить #{task_id}.\n<code>{html.escape(output[:200])}</code>"


def cmd_digest() -> str:
    """Рассылка активных поручений: check-deadlines (просрочено/сегодня/завтра).
    task_manager сам шлёт дайджест в общий чат, сюда возвращает текст."""
    success, output = run_task_manager('check-deadlines')
    return output.strip() if output.strip() else ("✅ Готово." if success else "❌ Ошибка check-deadlines")


def cmd_new_registry(title: str, username: str) -> str:
    try:
        client = _gsheets_client()
        spreadsheet = client.create(title)
        ws = spreadsheet.sheet1
        ws.update(range_name='A1:J1', values=[TASK_HEADERS])
        ws.format('A1:J1', {'textFormat': {'bold': True},
                            'backgroundColor': {'red': 0.9, 'green': 0.9, 'blue': 0.9}})

        cfg = load_config()
        owner_email = (cfg.get('owner_email') or '').strip()
        if owner_email:
            try:
                spreadsheet.share(owner_email, perm_type='user', role='writer', notify=False)
                share_note = f"📧 Доступ выдан: {html.escape(owner_email)}"
            except Exception as e:
                share_note = (f"⚠️ Не удалось выдать доступ {html.escape(owner_email)}: "
                              f"{html.escape(str(e)[:120])}")
        else:
            share_note = ("⚠️ owner_email в конфиге не задан — выдайте доступ "
                          "сервисному аккаунту вручную.")

        old_id = cfg.get('spreadsheet_id', '')
        # v3.1 fix: добавляем новый реестр в список registries и делаем активным
        registries = cfg.setdefault('registries', [])
        # Сбрасываем active у всех существующих
        for r in registries:
            r['active'] = False
        # Добавляем новый реестр как активный
        registries.append({
            'id': spreadsheet.id,
            'name': title,
            'active': True,
        })
        # Fallback для совместимости со старыми модулями
        cfg['prev_spreadsheet_id'] = old_id
        cfg['spreadsheet_id'] = spreadsheet.id
        save_config(cfg)
        invalidate_cache()

        audit("new_registry", "-",
              f"Новый реестр «{title}» (id {spreadsheet.id}), предыдущий {old_id}",
              username)
        log(f"Создан новый реестр «{title}»: {spreadsheet.id} (был {old_id})")

        return (f"✅ Новый реестр «<b>{html.escape(title)}</b>» создан и подключён!\n\n"
                f"📋 Ссылка: https://docs.google.com/spreadsheets/d/{spreadsheet.id}/edit\n"
                f"{share_note}\n\n"
                f"Предыдущий реестр сохранён в конфиге как prev_spreadsheet_id.")
    except Exception as e:
        log(f"⚠️ Ошибка создания реестра: {e}")
        return f"❌ Не удалось создать реестр: <code>{html.escape(str(e)[:200])}</code>"


def cmd_switch_registry(name: str, username: str) -> str:
    """Переключает активный реестр по названию."""
    cfg = load_config()
    registries = cfg.get('registries', [])
    for r in registries:
        if r.get('name') == name:
            for reg in registries:
                reg['active'] = (reg.get('name') == name)
            cfg['spreadsheet_id'] = r['id']
            save_config(cfg)
            invalidate_cache()
            audit("switch_registry", "-", f"Переключено на «{name}»", username)
            return with_footer(
                f"✅ Активный реестр изменён на «<b>{html.escape(name)}</b>»\n\n"
                f"📋 {registry_link()}"
            )
    return f"❌ Реестр «<b>{html.escape(name)}</b>» не найден."


def _service_account_email() -> str:
    try:
        with open(os.path.join(CREDS_DIR, 'gsheets-service-account.json'),
                  'r', encoding='utf-8') as f:
            return json.load(f).get('client_email', '')
    except Exception:
        return ''


def cmd_connect_registry(title: str, url_or_id: str, username: str) -> str:
    """Подключает существующую Google-таблицу как реестр и делает активной."""
    m = re.search(r"/d/([a-zA-Z0-9_-]{20,})", url_or_id)
    sid = m.group(1) if m else url_or_id.strip()
    if not re.fullmatch(r"[a-zA-Z0-9_-]{20,}", sid):
        return ("❌ Не удалось распознать ID таблицы. Пришлите ссылку вида:\n"
                "<code>https://docs.google.com/spreadsheets/d/&lt;ID&gt;/edit</code>")

    cfg = load_config()
    registries = cfg.setdefault('registries', [])
    for r in registries:
        if r.get('id') == sid:
            return (f"ℹ️ Эта таблица уже подключена как реестр "
                    f"«<b>{html.escape(r.get('name', ''))}</b>».")
    if any(r.get('name') == title for r in registries):
        return (f"❌ Реестр с названием «<b>{html.escape(title)}</b>» уже есть. "
                f"Выберите другое название.")

    try:
        client = _gsheets_client()
        spreadsheet = client.open_by_key(sid)
    except Exception as e:
        return (f"❌ Нет доступа к таблице. Откройте доступ (редактор) "
                f"сервисному аккаунту и повторите:\n"
                f"<code>{html.escape(_service_account_email())}</code>\n\n"
                f"<code>{html.escape(str(e)[:150])}</code>")

    # Проверяем чтение заголовков и наличие обязательных колонок
    # (синонимы — дубль COLUMN_SYNONYMS из task_manager.py, держать синхронно)
    synonyms = {
        "ID": ["id", "№"],
        "Описание": ["описание", "opisanie"],
        "Ответственный": ["ответственный", "otvetstvenniy"],
        "Срок": ["срок", "srok", "srok korr", "srok plan"],
        "Статус": ["статус", "status"],
    }
    notes = ""
    try:
        ws = spreadsheet.sheet1
        head = [h.strip().lower() for h in ws.row_values(1)]
        missing = [label for label, names in synonyms.items()
                   if not any(n in head for n in names)]
        if missing:
            notes += ("⚠️ Не найдены обязательные колонки: "
                      + ", ".join(missing) + ".\n\n")
    except Exception as e:
        return (f"❌ Таблица открылась, но не читается: "
                f"<code>{html.escape(str(e)[:150])}</code>")

    # Проверяем доступ на запись (перезаписываем A1 тем же значением)
    try:
        ws.update_acell('A1', ws.acell('A1').value or "")
    except Exception:
        notes += ("⚠️ Нет прав на запись — бот сможет только читать реестр. "
                  "Выдайте сервисному аккаунту права «Редактор»:\n"
                  f"<code>{html.escape(_service_account_email())}</code>\n\n")

    for r in registries:
        r['active'] = False
    registries.append({'id': sid, 'name': title, 'active': True})
    cfg['spreadsheet_id'] = sid
    save_config(cfg)
    invalidate_cache()

    audit("connect_registry", "-", f"Подключён реестр «{title}» (id {sid})", username)
    log(f"Подключён существующий реестр «{title}»: {sid}")

    return (f"✅ Реестр «<b>{html.escape(title)}</b>» подключён и активен!\n\n"
            f"{notes}"
            f"📋 https://docs.google.com/spreadsheets/d/{sid}/edit")


# ======== ВЕЧЕРНИЙ ДАЙДЖЕСТ ========

def build_evening_digest() -> Optional[str]:
    today = now_msk().strftime("%d.%m.%Y")
    entries = [r for r in read_audit_entries() if r and str(r[0]).startswith(today)]
    if not entries:
        return None
    action_emoji = {"create": "➕", "close": "✅", "update": "✏️", "delete": "🗑",
                    "new_registry": "🆕", "switch_registry": "🔄", "feedback": "💡",
                    "connect_registry": "🔗"}
    lines = [f"📊 <b>Изменения реестра за {today}</b> ({len(entries)})\n"]
    for row in entries:
        row = list(row) + [""] * (5 - len(row))
        ts, user, action, task_id, details = row[:5]
        time_part = ts.split(" ")[1][:5] if " " in ts else ts
        emoji = action_emoji.get(action, "•")
        id_part = f" #{html.escape(task_id)}" if task_id not in ("", "-") else ""
        lines.append(f"{emoji} {time_part} {html.escape(user)} "
                     f"<b>{html.escape(action)}</b>{id_part}"
                     + (f" — {html.escape(details[:120])}" if details else ""))
    return with_footer("\n".join(lines))


def digest_loop():
    last_sent_date = None
    while True:
        try:
            t = now_msk()
            digest_time = load_config().get("digest_time", "20:47")
            if (t.strftime("%H:%M") == digest_time
                    and last_sent_date != t.strftime("%d.%m.%Y")):
                last_sent_date = t.strftime("%d.%m.%Y")
                text = build_evening_digest()
                if text:
                    chat_ids = get_admin_chat_ids(load_config())
                    if chat_ids:
                        for cid in chat_ids:
                            send_message(cid, text)
                        log(f"Вечерний дайджест отправлен {len(chat_ids)} админам")
                    else:
                        group_chat = get_group_chat_id()
                        if group_chat:
                            send_message(group_chat, text)
                            log("Вечерний дайджест отправлен в общий чат")
                else:
                    log("Вечерний дайджест: изменений за день нет, не отправляю")
        except Exception as e:
            log(f"⚠️ Ошибка в digest_loop: {e}")
        time.sleep(30)


# ======== ПРИВЕТСТВИЕ ========

def greeting_text(first_name: str, role: str) -> str:
    reg = get_active_registry()
    reg_link = registry_link()
    reg_info = f"\n\n📋 Активный реестр: <b>{html.escape(reg.get('name', 'Неизвестно'))}</b>\n🔗 <a href='{reg_link}'>Открыть реестр</a>"
    if role == "admin":
        return (
            f"👋 <b>Привет, {html.escape(first_name or 'друг')}!</b>{reg_info}\n\n"
            "Вы администратор. Кнопки внизу:\n"
            "📝 <b>Редактировать</b> — включить режим свободной формы: опишите "
            "изменение реестра текстом, я внесу правки и пришлю подтверждение\n"
            "🔍 <b>Проверить</b> — аудит реестра\n"
            "📊 <b>Дайджест</b> — рассылка активных поручений из реестра\n"
            "📋 <b>Реестры</b> — переключение активного реестра\n"
            "📋 <b>Мои поручения</b> — ваши открытые задачи"
        )
    return (
        f"👋 <b>Привет, {html.escape(first_name or 'друг')}!</b>{reg_info}\n\n"
        f"Я бот реестра поручений.\n\n"
        f"📋 <b>Мои поручения</b> — ваши открытые задачи, закрытие в один тап"
    )


# ======== DISPATCH ========

def dispatch(cmd: "commands.ParsedCommand", username: str, first_name: str,
             chat_id, key: str, user_id=None) -> str:
    """Выполняет распознанную команду и возвращает текст ответа."""
    cfg = load_config()
    name, args = cmd.name, cmd.args

    if name == "registry_link":
        return f"📋 Реестр поручений:\n{registry_link()}"

    if name == "list_my":
        return cmd_list_my(username, user_id)
    if name == "list_all":
        return cmd_list_all()
    if name == "list_project":
        return cmd_list_project(args["project"])
    if name == "list_status":
        return cmd_list_status(args["status"])
    if name == "close":
        return cmd_close_task(args["id"], username, user_id)

    if name == "create":
        dup = find_recent_duplicate(args["contragent"], args["description"])
        if dup:
            return (f"⚠️ Похоже, такое поручение уже создавалось недавно "
                    f"(#{dup[3]}, {dup[0]}, {dup[1]}).\n"
                    f"Контрагент и описание совпадают — дубль не создаю. "
                    f"Если это другое поручение, измените описание.")
        _set_user_state(key, "confirm_create", args)
        return cmd_create_preview(args, username)

    if name == "deadline":
        return _cmd_update(args["id"], "--deadline", args["date"],
                           f"срок изменён на <b>{args['date']}</b>",
                           username, f"Срок → {args['date']}")
    if name == "status":
        return _cmd_update(args["id"], "--status", args["status"],
                           f"статус изменён на <b>{html.escape(args['status'])}</b>",
                           username, f"Статус → {args['status']}")
    if name == "assignee":
        return _cmd_update(args["id"], "--assignee", args["assignee"],
                           f"ответственный изменён на <b>{html.escape(args['assignee'])}</b>",
                           username, f"Ответственный → {args['assignee']}")
    if name == "description":
        return _cmd_update(args["id"], "--description", args["description"],
                           "описание обновлено",
                           username, f"Описание → {args['description'][:100]}")
    if name == "comment":
        return _cmd_update(args["id"], "--comment", args["comment"],
                           "комментарий добавлен",
                           username, f"Комментарий → {args['comment'][:100]}")
    if name == "delete":
        task = get_task_info(args["id"])
        if not task:
            return f"❌ Поручение <b>#{args['id']}</b> не найдено."
        _set_user_state(key, "confirm_delete", {"id": args["id"]})
        return (f"🗑 <b>Удалить поручение #{args['id']}?</b>\n\n"
                f"   📝 {html.escape(task.get('description', ''))}\n\n"
                f"Напишите <b>да</b> для подтверждения (60 сек), любой другой текст — отмена.")
    if name == "digest":
        return cmd_digest()
    if name == "new_registry":
        return cmd_new_registry(args["title"], username)
    if name == "switch_registry":
        return cmd_switch_registry(args["name"], username)
    if name == "connect_registry":
        return cmd_connect_registry(args["title"], args["url"], username)

    return "🤔 Не понял команду."



# ======== ПРОВЕРКА МАППИНГА ПРИ ВХОДЕ В ADMIN MODE ========

def run_registry_audit(chat_id, key, username: str):
    """Полная проверка реестра: маппинг (с учётом вкладки Контакты), пустые поля, орфография.
    Показывает summary + inline-кнопку Исправить."""
    tasks = get_all_tasks()
    mapping = load_user_mapping()
    contacts = load_contacts_from_registry()

    issues = {"unmapped": [], "empty_fields": [], "spelling": [], "contacts_auto": []}
    unmapped_map = {}  # name -> {task_id, description}

    for task in tasks:
        tid = task.get('id')
        assignees_raw = task.get('assignee', '')
        deadline = task.get('deadline', '').strip()
        description = task.get('description', '').strip()
        project = task.get('contragent', '').strip()

        # --- незамапленные ---
        # Считаем замапленным, если имя содержит любой ключ user_mapping
        # (как в дайджесте: «Денис» покрывает «Денис Ц.»)
        if assignees_raw:
            for name in assignees_raw.split(','):
                name = name.strip()
                if name and not any(k and k.lower() in name.lower() for k in mapping):
                    if name not in unmapped_map:
                        unmapped_map[name] = {"task_id": tid, "description": description[:60]}

        # --- пустые поля ---
        empty = []
        if not deadline:
            empty.append("срок")
        if not description:
            empty.append("описание")
        if not project:
            empty.append("контрагент")
        if empty:
            issues["empty_fields"].append({"id": tid, "fields": empty, "desc": description[:40]})

        # --- орфография ---
        if description:
            suspicious = []
            words = re.findall(r"[А-Яа-яA-Za-z]+", description)
            for w in words:
                lw = w.lower()
                if re.search(r"(.)\1{2,}", lw):
                    suspicious.append(w)
            if suspicious:
                issues["spelling"].append({"id": tid, "words": suspicious[:5], "desc": description[:40]})

    # Разделяем unmapped: есть в Контактах vs нет
    # (мягкое сопоставление: "Плахотин" ↔ "Плахотин Константин")
    contacts_lower = {k: v for k, v in contacts.items()}
    for name in sorted(unmapped_map.keys()):
        info = unmapped_map[name]
        name_lower = name.lower()
        login = contacts_lower.get(name_lower)
        if not login:
            # Пробуем мягкое сопоставление: ищем контакт, который содержит name или name содержит контакт
            for contact_name, contact_login in contacts_lower.items():
                if name_lower in contact_name or contact_name in name_lower:
                    login = contact_login
                    break
        if login:
            issues["contacts_auto"].append({"name": name, "login": login})
        else:
            issues["unmapped"].append({"name": name, "task_id": info["task_id"], "description": info["description"]})

    total = len(issues["unmapped"]) + len(issues["contacts_auto"]) + len(issues["empty_fields"]) + len(issues["spelling"])
    if total == 0:
        send_message(chat_id, "✅ <b>Проверка реестра завершена.</b>\n\nНарушений не найдено.")
        return

    lines = [f"🔍 <b>Проверка реестра</b> (найдено проблем: {total})\n"]
    if issues["contacts_auto"]:
        lines.append(f"<b>Найдены во вкладке «Контакты»</b> ({len(issues['contacts_auto'])}) — можно смэппить автоматически:")
        for it in issues["contacts_auto"]:
            lines.append(f"• {html.escape(it['name'])} → {html.escape(it['login'])}")
        lines.append("")
    if issues["unmapped"]:
        lines.append(f"<b>Незамапленные (не в Контактах)</b> ({len(issues['unmapped'])}):")
        for it in issues["unmapped"]:
            lines.append(f"• {html.escape(it['name'])} (поручение <b>#{it['task_id']}</b>: {html.escape(it['description'])})")
        lines.append("")
    if issues["empty_fields"]:
        lines.append(f"<b>Пустые поля</b> ({len(issues['empty_fields'])}):")
        for it in issues["empty_fields"]:
            lines.append(f"• ID {it['id']}: {', '.join(it['fields'])}")
        lines.append("")
    if issues["spelling"]:
        lines.append(f"<b>Возможные опечатки</b> ({len(issues['spelling'])}):")
        for it in issues["spelling"]:
            words_str = ", ".join(it['words'])
            lines.append(f"• ID {it['id']}: {html.escape(words_str)}")
        lines.append("")

    lines.append("Исправить найденные проблемы?")

    keyboard = {
        "inline_keyboard": [
            [{"text": "🛠 Исправить", "callback_data": "fix_registry"},
             {"text": "⏭ Пропустить", "callback_data": "skip_registry"}]
        ]
    }
    _set_user_state(key, "audit_issues", {"issues": issues})
    send_message(chat_id, "\n".join(lines), reply_markup=keyboard)


# ======== ОБРАБОТКА CALLBACK ========

_processed_callbacks = set()
_MAX_CALLBACK_CACHE = 1000

def process_callback(callback: Dict):
    callback_id = callback.get('id')
    # Защита от дублей callback
    if callback_id in _processed_callbacks:
        return
    _processed_callbacks.add(callback_id)
    if len(_processed_callbacks) > _MAX_CALLBACK_CACHE:
        _processed_callbacks.clear()
    data = callback.get('data', '')
    message = callback.get('message', {})
    chat = message.get('chat', {})
    chat_id = chat.get('id')
    message_id = message.get('message_id')

    from_user = callback.get('from', {})
    username = from_user.get('username', '')
    user_id = from_user.get('id')
    key = _state_key(chat_id, user_id)

    cfg = load_config()
    role = resolve_role(username, cfg, user_id)


    allowed, warning = flood.check(user_id, role, cfg["limits"])
    callback_id = callback.get('id')
    data = callback.get('data', '')
    message = callback.get('message', {})
    chat = message.get('chat', {})
    chat_id = chat.get('id')
    message_id = message.get('message_id')

    from_user = callback.get('from', {})
    username = from_user.get('username', '')
    user_id = from_user.get('id')
    key = _state_key(chat_id, user_id)

    cfg = load_config()

    from_user = callback.get('from', {})
    username = from_user.get('username', '')
    user_id = from_user.get('id')

    cfg = load_config()
    role = resolve_role(username, cfg, user_id)

    allowed, warning = flood.check(user_id, role, cfg["limits"])
    if not allowed:
        answer_callback_query(callback_id, text=warning or "⏳ Лимит команд исчерпан.")
        log(f"Антифлуд (кнопка): @{username} ({user_id}) заблокирован")
        return

    if data in ("my_tasks", "close_menu", "refresh"):
        text, keyboard = build_my_tasks_view(username, user_id)
        if message_id:
            ok = edit_message(chat_id, message_id, text, reply_markup=keyboard)
            if not ok:
                send_message(chat_id, text, reply_markup=keyboard)
        else:
            send_message(chat_id, text, reply_markup=keyboard)
        answer_callback_query(callback_id)
        return

    if data == "select_registry":
        text, keyboard = build_registry_selector()
        send_message(chat_id, text, reply_markup=keyboard)
        answer_callback_query(callback_id)
        return

    if data.startswith("switch_registry:"):
        registry_name = data.split(":", 1)[1]
        response = cmd_switch_registry(registry_name, username)
        send_message(chat_id, response)
        answer_callback_query(callback_id)
        return

    if data.startswith("close:"):
        try:
            task_id = int(data.split(":", 1)[1])
        except ValueError:
            answer_callback_query(callback_id, text="❌ Некорректный номер.")
            return
        toast, success = handle_close_callback(task_id, username, user_id)
        answer_callback_query(callback_id, text=toast[:190])
        if success and message_id:
            text, keyboard = build_my_tasks_view(username, user_id)
            edit_message(chat_id, message_id, text, reply_markup=keyboard)
        return

    if data == "send_digest":
        if role != "admin":
            answer_callback_query(callback_id, text="❌ Только для администраторов.")
            return
        response = cmd_digest()
        send_message(chat_id, response)
        answer_callback_query(callback_id)
        return

    if data == "fix_unmapped":
        state = _get_user_state(key)
        if state and state.get("state") == "audit_issues":
            unmapped = state["data"]["unmapped"]
            if unmapped:
                _set_user_state(key, "collect_username", {
                    "unmapped": unmapped,
                    "current": unmapped[0],
                    "index": 0,
                    "collected": {}
                })
                send_message(chat_id, (
                    f"🔧 <b>Исправление привязок</b>\n\n"
                    f"Введите Telegram-логин для <b>{html.escape(unmapped[0])}</b>:\n"
                    f"<code>@username</code>"
                ))
        answer_callback_query(callback_id)
        return

    if data == "skip_unmapped":
        _set_user_state(key, "admin_mode")
        send_message(chat_id, (
            f"💬 <b>Режим администратора активен</b>\n\n"
            f"Пишите любую задачу по изменению реестра поручений "
            f"в свободной форме — я пойму, внесу правки и пришлю подтверждение.\n\n"
            f"📋 Активный реестр: <b>{html.escape(get_active_registry().get('name', 'Неизвестно'))}</b>"
        ), reply_markup=admin_mode_keyboard())
        answer_callback_query(callback_id)
        return

    if data == "fix_registry":
        state = _get_user_state(key)
        if state and state.get("state") == "audit_issues":
            issues = state["data"]["issues"]
            contacts_auto = issues.get("contacts_auto", [])
            unmapped = issues.get("unmapped", [])
            empty_fields = issues.get("empty_fields", [])

            # 1. Автомаппинг из Контактов
            if contacts_auto:
                mapping = load_user_mapping()
                for it in contacts_auto:
                    mapping[it["name"]] = it["login"]
                save_user_mapping(mapping)
                send_message(chat_id, (
                    f"📇 <b>Автоматически смэпплено из «Контактов»:</b> {len(contacts_auto)}\n"
                    + "\n".join(f"• {html.escape(c['name'])} → {html.escape(c['login'])}" for c in contacts_auto)
                ))

            # 2. Если есть ручные unmapped — начинаем пошаговый сбор
            if unmapped:
                first = unmapped[0]
                _set_user_state(key, "collect_username", {
                    "unmapped": unmapped,
                    "current": first["name"],
                    "index": 0,
                    "collected": {},
                    "next_empty_fields": empty_fields,
                    "next_spelling": issues.get("spelling", [])
                })
                send_message(chat_id, (
                    f"🔧 <b>Исправление привязок</b> ({1}/{len(unmapped)})\n\n"
                    f"Ответственный: <b>{html.escape(first['name'])}</b>\n"
                    f"Поручение <b>#{first['task_id']}</b>: {html.escape(first['description'])}\n\n"
                    f"Введите Telegram-логин:\n"
                    f"<code>@username</code>"
                ))
            # 3. Иначе если есть пустые поля — переходим к ним
            elif empty_fields:
                _set_user_state(key, "fix_empty_fields", {
                    "items": empty_fields,
                    "index": 0,
                    "collected": [],
                    "next_spelling": issues.get("spelling", [])
                })
                first = empty_fields[0]
                send_message(chat_id, (
                    f"📝 <b>Исправление пустых полей</b> ({1}/{len(empty_fields)})\n\n"
                    f"Задача <b>ID {first['id']}</b>\n"
                    f"Пустые поля: {', '.join(first['fields'])}\n\n"
                    f"Введите значения через запятую в том же порядке."
                ))
            # 4. Иначе если есть опечатки — переходим к ним
            elif issues.get("spelling"):
                sp = issues["spelling"]
                _set_user_state(key, "fix_spelling", {
                    "items": sp,
                    "index": 0,
                    "collected": []
                })
                first = sp[0]
                send_message(chat_id, (
                    f"✏️ <b>Исправление опечаток</b> ({1}/{len(sp)})\n\n"
                    f"Задача <b>ID {first['id']}</b>\n"
                    f"Подозрительные слова: {', '.join(first['words'])}\n\n"
                    f"Введите правильные варианты через запятую в том же порядке."
                ))
            else:
                send_message(chat_id, "✅ Все проблемы исправлены или отсутствуют.")
                _clear_user_state(key)
        answer_callback_query(callback_id)
        return

    if data == "skip_registry":
        _clear_user_state(key)
        send_message(chat_id, "⏭ Проверка пропущена. Режим администратора не активирован.")
        answer_callback_query(callback_id)
        return

    if data == "admin_mode":
        if role == "admin":
            send_message(chat_id, (
                f"💬 <b>Режим администратора активен</b>\n\n"
                f"Пишите любую задачу по изменению реестра поручений "
                f"в свободной форме — я пойму, внесу правки и пришлю подтверждение.\n\n"
                f"📋 Активный реестр: <b>{html.escape(get_active_registry().get('name', 'Неизвестно'))}</b>\n"
                f"🔗 {registry_link()}"
            ))
        else:
            send_message(chat_id, "🔒 Эта функция доступна только администраторам.")
        answer_callback_query(callback_id)
        return

    answer_callback_query(callback_id, text="❓ Неизвестная кнопка.")


# ======== ФИДБЕК ИЗ ОБЩЕГО ЧАТА (v3.1) ========

def _handle_group_feedback(message: Dict, fb_type: str, fb_text: str):
    """Приём идеи/бага из общего чата: запись во вкладку «Бэклог BL-6».

    Единственное исключение из правила «в группе бот молчит».
    Антифлуд общий с остальными командами. Запись логируется в аудит
    (действие feedback) — попадает в вечерний дайджест.
    """
    chat_id = message.get('chat', {}).get('id')
    from_user = message.get('from', {})
    username = from_user.get('username', '')
    user_id = from_user.get('id')
    msg_id = message.get('message_id')

    if not fb_text:
        send_message(chat_id,
                     "ℹ️ Пустое сообщение. Напишите так:\n"
                     "<code>/идея ваш текст</code> или <code>/баг ваш текст</code>",
                     reply_to=msg_id)
        return

    cfg = load_config()
    role = resolve_role(username, cfg, user_id)
    allowed, warning = flood.check(user_id, role, cfg["limits"])
    if not allowed:
        if warning:
            send_message(chat_id, warning, reply_to=msg_id)
        log(f"Антифлуд (фидбек): @{username} ({user_id}) заблокирован")
        return

    try:
        num = feedback.add_feedback(username, fb_type, fb_text, log_fn=log)
    except Exception as e:
        log(f"⚠️ Ошибка записи фидбека: {e}")
        send_message(chat_id,
                     "❌ Не удалось записать. Попробуйте позже или передайте "
                     "администратору лично.",
                     reply_to=msg_id)
        return

    audit("feedback", num, f"{fb_type}: {fb_text[:100]}", username)
    log(f"Фидбек #{num} ({fb_type}) от @{username}: {fb_text[:80]}")
    kind = "идею" if fb_type == "Идея" else "баг"
    send_message(chat_id,
                 f"✅ Записал {kind} <b>#{num}</b>. Спасибо!\n"
                 f"Администратор посмотрит и возьмёт в работу.",
                 reply_to=msg_id)


# ======== ОБРАБОТКА ОБНОВЛЕНИЙ ========

_processed_messages = {}
_MAX_MSG_CACHE = 1000
_MSG_DEDUP_TTL = 5  # секунд

def process_updates(updates: List[Dict]):
    for update in updates:
        if 'callback_query' in update:
            try:
                cb = update['callback_query']
                log(f"📩 callback @{cb.get('from', {}).get('username', '?')}: "
                    f"{cb.get('data', '')[:60]!r}")
                process_callback(cb)
            except Exception as e:
                log(f"⚠️ Ошибка обработки callback: {e}")
            continue

        message = update.get('message')
        if not message:
            continue

        text = message.get('text', '')
        if not text:
            continue

        log(f"📩 msg @{message.get('from', {}).get('username', '?')} "
            f"uid={message.get('from', {}).get('id')} "
            f"chat={message.get('chat', {}).get('id')}: {text[:70]!r}")

        chat = message.get('chat', {})
        chat_id = chat.get('id')

        # --- группа: бот молчит, кроме команд сбора фидбека (v3.1) ---
        if chat.get('type') != 'private':
            fb = feedback.parse_feedback_command(text, BOT_USERNAME)
            if fb:
                try:
                    _handle_group_feedback(message, fb[0], fb[1])
                except Exception as e:
                    log(f"⚠️ Ошибка обработки фидбека: {e}")
            continue

        from_user = message.get('from', {})
        username = from_user.get('username', '')
        first_name = from_user.get('first_name', '')
        user_id = from_user.get('id')
        key = _state_key(chat_id, user_id)

        cfg = load_config()
        role = resolve_role(username, cfg, user_id)

        # --- обработка reply-кнопок ---
        text_clean = text.strip()

        if text_clean == "📋 Мои поручения" or text_clean == "Мои поручения":
            view_text, view_kb = build_my_tasks_view(username, user_id)
            if view_kb:
                send_message(chat_id, view_text, reply_markup=view_kb)
            else:
                send_message(chat_id, view_text)
            continue
        if text_clean in ("📝 Редактировать реестр", "Редактировать реестр",
                          "📝 Редактировать", "Редактировать") and role == "admin":
            _set_user_state(key, "admin_mode")
            send_message(chat_id, (
                f"💬 <b>Режим администратора активен</b>\n\n"
                f"Пишите любую задачу по изменению реестра поручений "
                f"в свободной форме — я пойму, внесу правки и пришлю подтверждение.\n\n"
                f"📋 Активный реестр: <b>{html.escape(get_active_registry().get('name', 'Неизвестно'))}</b>\n"
                f"🔗 {registry_link()}"
            ), reply_markup=admin_mode_keyboard())
            continue
        if text_clean in ("📊 Отправить дайджест", "Отправить дайджест",
                          "📊 Дайджест", "Дайджест") and role == "admin":
            response = cmd_digest()
            send_message(chat_id, response)
            continue

        if text_clean in ("🔍 Проверить реестр", "Проверить реестр",
                          "🔍 Проверить", "Проверить") and role == "admin":
            # Защита от дублей: если аудит уже запущен для этого пользователя, пропускаем
            audit_state = _get_user_state(key)
            if audit_state and audit_state.get("state") == "audit_in_progress":
                send_message(chat_id, "⏳ Проверка реестра уже выполняется, подождите...")
                continue
            _set_user_state(key, "audit_in_progress")
            try:
                run_registry_audit(chat_id, key, username)
            finally:
                # Очищаем флаг аудита, если он еще установлен
                current = _get_user_state(key)
                if current and current.get("state") == "audit_in_progress":
                    _clear_user_state(key)
            continue
        if (text_clean == "❌ Выйти" or text_clean == "Выйти") and role == "admin":
            _clear_user_state(key)
            send_message(chat_id, "👋 <b>Режим администратора отключён.</b>",
                         reply_markup=reply_main_keyboard(role))
            continue
        if (text_clean == "/start" or text_clean == "/help" or text_clean == "привет" or text_clean == "начать") and role == "admin":
            send_message(chat_id, greeting_text(first_name, role),
                         reply_to=message.get('message_id'),
                         reply_markup=main_keyboard(role))
            continue

        if text_clean in ("📋 Выбрать реестр", "Выбрать реестр",
                          "📋 Реестры", "Реестры") and role == "admin":
            sel_text, sel_kb = build_registry_selector()
            send_message(chat_id, sel_text, reply_markup=sel_kb)
            continue

        # Защита от дублей сообщений (только для обычных сообщений, не reply-кнопок)
        msg_dedup_key = f"{chat_id}:{user_id}:{text}"
        now = time.time()
        if msg_dedup_key in _processed_messages:
            if now - _processed_messages[msg_dedup_key] < _MSG_DEDUP_TTL:
                continue
        _processed_messages[msg_dedup_key] = now
        if len(_processed_messages) > _MAX_MSG_CACHE:
            _processed_messages.clear()

        if role == "admin":
            remember_admin_chat(username, chat_id, user_id)

        allowed, warning = flood.check(user_id, role, cfg["limits"])
        if not allowed:
            if warning:
                send_message(chat_id, warning, reply_to=message.get('message_id'))
            log(f"Антифлуд: @{username} ({user_id}) заблокирован")
            continue

        # --- сбор логинов для незамапленных ---
        state = _get_user_state(key)
        if state and state.get("state") == "collect_username":
            data = state["data"]
            current_name = data["current"]
            index = data["index"]
            unmapped = data["unmapped"]
            collected = data["collected"]
            tg_login = text.strip().lstrip('@')
            if tg_login:
                collected[current_name] = tg_login
            nxt = index + 1
            if nxt < len(unmapped):
                nxt_item = unmapped[nxt]
                _set_user_state(key, "collect_username", {
                    "unmapped": unmapped,
                    "current": nxt_item["name"],
                    "index": nxt,
                    "collected": collected
                })
                send_message(chat_id, (
                    f"🔧 <b>Исправление привязок</b> ({nxt+1}/{len(unmapped)})\n\n"
                    f"Ответственный: <b>{html.escape(nxt_item['name'])}</b>\n"
                    f"Поручение <b>#{nxt_item['task_id']}</b>: {html.escape(nxt_item['description'])}\n\n"
                    f"Введите Telegram-логин:\n"
                    f"<code>@username</code>"
                ))
            else:
                lines = ["📋 <b>Собранные привязки:</b>\n"]
                for name, login in collected.items():
                    lines.append(f"• {html.escape(name)} → @{html.escape(login)}")
                lines.append("\nВнести в реестр? Напишите <b>да</b> (60 сек), любой другой текст — отмена.")
                next_empty = data.get("next_empty_fields", [])
                next_spell = data.get("next_spelling", [])
                _set_user_state(key, "confirm_registry_fix", {
                    "collected": collected,
                    "type": "mapping",
                    "next_empty_fields": next_empty,
                    "next_spelling": next_spell
                })
                send_message(chat_id, "\n".join(lines))
            continue

        # --- исправление пустых полей ---
        state = _get_user_state(key)
        if state and state.get("state") == "fix_empty_fields":
            data = state["data"]
            items = data["items"]
            index = data["index"]
            collected = data["collected"]
            vals = [v.strip() for v in text.split(",")]
            collected.append({"id": items[index]["id"], "values": vals})
            nxt = index + 1
            if nxt < len(items):
                _set_user_state(key, "fix_empty_fields", {
                    "items": items,
                    "index": nxt,
                    "collected": collected
                })
                it = items[nxt]
                send_message(chat_id, (
                    f"📝 <b>Исправление пустых полей</b> ({nxt+1}/{len(items)})\n\n"
                    f"Задача <b>ID {it['id']}</b>\n"
                    f"Пустые поля: {', '.join(it['fields'])}\n\n"
                    f"Введите значения через запятую в том же порядке."
                ))
            else:
                lines = ["📋 <b>Собранные правки:</b>\n"]
                for c in collected:
                    lines.append(f"• ID {c['id']}: {html.escape(', '.join(c['values']))}")
                lines.append("\nВнести в реестр? Напишите <b>да</b> (60 сек), любой другой текст — отмена.")
                next_spell = data.get("next_spelling", [])
                _set_user_state(key, "confirm_registry_fix", {
                    "collected": collected,
                    "type": "empty_fields",
                    "next_spelling": next_spell
                })
                send_message(chat_id, "\n".join(lines))
            continue

        # --- исправление опечаток ---
        state = _get_user_state(key)
        if state and state.get("state") == "fix_spelling":
            data = state["data"]
            items = data["items"]
            index = data["index"]
            collected = data["collected"]
            vals = [v.strip() for v in text.split(",")]
            collected.append({"id": items[index]["id"], "words": items[index]["words"], "values": vals})
            nxt = index + 1
            if nxt < len(items):
                _set_user_state(key, "fix_spelling", {
                    "items": items,
                    "index": nxt,
                    "collected": collected
                })
                it = items[nxt]
                send_message(chat_id, (
                    f"✏️ <b>Исправление опечаток</b> ({nxt+1}/{len(items)})\n\n"
                    f"Задача <b>ID {it['id']}</b>\n"
                    f"Подозрительные слова: {', '.join(it['words'])}\n\n"
                    f"Введите правильные варианты через запятую в том же порядке."
                ))
            else:
                lines = ["📋 <b>Собранные правки:</b>\n"]
                for c in collected:
                    lines.append(f"• ID {c['id']}: {html.escape(', '.join(c['values']))}")
                lines.append("\nВнести в реестр? Напишите <b>да</b> (60 сек), любой другой текст — отмена.")
                _set_user_state(key, "confirm_registry_fix", {"collected": collected, "type": "spelling"})
                send_message(chat_id, "\n".join(lines))
            continue

        # --- ожидающее подтверждение ---
        state = _get_user_state(key)
        if state and state.get("state", "").startswith("confirm_") and role == "admin":
            _clear_user_state(key)
            if text.strip().lower() in ("да", "✅ да", "д", "yes"):
                if state["state"] == "confirm_create":
                    response = cmd_create_execute(state["data"], username, first_name)
                    # Авто-выход из режима редактирования
                    send_message(chat_id, response + "\n\n🔒 Режим редактирования отключен. Отправьте любое сообщение чтобы продолжить.",
                                 reply_markup=reply_main_keyboard(role))
                    continue
                elif state["state"] == "confirm_delete":
                    response = cmd_delete_execute(state["data"]["id"], username)
                    # Авто-выход из режима редактирования
                    send_message(chat_id, response + "\n\n🔒 Режим редактирования отключен. Отправьте любое сообщение чтобы продолжить.",
                                 reply_markup=reply_main_keyboard(role))
                    continue
                # confirm_llm удален — команды выполняются сразу без промежуточного подтверждения
                elif state["state"] == "confirm_registry_fix":
                    data = state["data"]
                    if data.get("type") == "mapping":
                        mapping = load_user_mapping()
                        for name, login in data["collected"].items():
                            mapping[name] = login
                        save_user_mapping(mapping)
                        response = "✅ Привязки сохранены."
                        # Автопереход к следующему этапу
                        next_empty = data.get("next_empty_fields", [])
                        next_spell = data.get("next_spelling", [])
                        if next_empty:
                            _set_user_state(key, "fix_empty_fields", {
                                "items": next_empty,
                                "index": 0,
                                "collected": [],
                                "next_spelling": next_spell
                            })
                            first = next_empty[0]
                            send_message(chat_id, (
                                f"📝 <b>Исправление пустых полей</b> ({1}/{len(next_empty)})\n\n"
                                f"Задача <b>ID {first['id']}</b>\n"
                                f"Пустые поля: {', '.join(first['fields'])}\n\n"
                                f"Введите значения через запятую в том же порядке."
                            ))
                            continue
                        elif next_spell:
                            _set_user_state(key, "fix_spelling", {
                                "items": next_spell,
                                "index": 0,
                                "collected": []
                            })
                            first = next_spell[0]
                            send_message(chat_id, (
                                f"✏️ <b>Исправление опечаток</b> ({1}/{len(next_spell)})\n\n"
                                f"Задача <b>ID {first['id']}</b>\n"
                                f"Подозрительные слова: {', '.join(first['words'])}\n\n"
                                f"Введите правильные варианты через запятую в том же порядке."
                            ))
                            continue
                    elif data.get("type") == "empty_fields":
                        ok_count = 0
                        fail_count = 0
                        for item in data["collected"]:
                            task_id = item["id"]
                            vals = item["values"]
                            fields = item.get("fields", [])
                            update_dict = {}
                            for i, field_name in enumerate(fields):
                                if i < len(vals) and vals[i]:
                                    update_dict[field_name] = vals[i]
                            if update_dict:
                                if update_task_fields_in_sheet(task_id, update_dict):
                                    ok_count += 1
                                else:
                                    fail_count += 1
                        response = f"✅ Пустые поля обновлены: {ok_count} задач."
                        if fail_count:
                            response += f"\n⚠️ Не удалось обновить: {fail_count} задач."
                        # Автопереход к опечаткам
                        next_spell = data.get("next_spelling", [])
                        if next_spell:
                            _set_user_state(key, "fix_spelling", {
                                "items": next_spell,
                                "index": 0,
                                "collected": []
                            })
                            first = next_spell[0]
                            send_message(chat_id, (
                                f"✏️ <b>Исправление опечаток</b> ({1}/{len(next_spell)})\n\n"
                                f"Задача <b>ID {first['id']}</b>\n"
                                f"Подозрительные слова: {', '.join(first['words'])}\n\n"
                                f"Введите правильные варианты через запятую в том же порядке."
                            ))
                            continue
                    elif data.get("type") == "spelling":
                        ok_count = 0
                        fail_count = 0
                        for item in data["collected"]:
                            task_id = item["id"]
                            words = item.get("words", [])
                            vals = item.get("values", [])
                            # Получаем текущее описание
                            task = get_task_info(int(task_id))
                            if task:
                                desc = task.get("description", "")
                                for i, word in enumerate(words):
                                    if i < len(vals) and vals[i]:
                                        desc = desc.replace(word, vals[i])
                                if update_task_fields_in_sheet(task_id, {"описание": desc}):
                                    ok_count += 1
                                else:
                                    fail_count += 1
                            else:
                                fail_count += 1
                        response = f"✅ Описания исправлены: {ok_count} задач."
                        if fail_count:
                            response += f"\n⚠️ Не удалось обновить: {fail_count} задач."
                    else:
                        response = "❌ Неизвестный тип исправления, отменено."
                else:
                    response = "❌ Неизвестное состояние, отменено."
            else:
                response = "❌ Отменено."
            send_message(chat_id, response, reply_to=message.get('message_id'))
            continue
        elif state and state.get("state") == "admin_mode_confirm":
            data = state.get("data", {})
            if text_clean.lower() in ("✅ да", "да", "yes", "д"):
                check = commands.parse_canonical(data.get("command_text", ""),
                                                  today=now_msk().date())
                if check.ok and check.name != "help":
                    try:
                        response = dispatch(check, username, first_name, chat_id, key, user_id)
                    except Exception as e:
                        log(f"⚠️ Ошибка выполнения команды {check.name}: {e}")
                        response = "❌ Внутренняя ошибка при выполнении команды."
                    # Если dispatch поставил следующее подтверждение (confirm_create/
                    # confirm_delete) — задача ещё НЕ выполнена: режим админа
                    # сохраняется, состояние не трогаем
                    nxt = _get_user_state(key)
                    if nxt and nxt.get("state", "") != "admin_mode_confirm" \
                            and nxt.get("state", "").startswith("confirm_"):
                        send_message(chat_id, response,
                                     reply_to=message.get('message_id'),
                                     reply_markup=confirm_keyboard())
                        continue
                    # Ошибка выполнения — задача не выполнена: остаёмся в режиме админа
                    if response.startswith("❌"):
                        _set_user_state(key, "admin_mode")
                        send_message(chat_id, response,
                                     reply_to=message.get('message_id'),
                                     reply_markup=admin_mode_keyboard())
                        continue
                    # Задача выполнена — только теперь отключаем режим админа
                    send_message(chat_id,
                        f"{response}\n\n"
                        "🔒 <b>Режим администратора отключён.</b>\n"
                        "Возвращаю стандартное меню управления.",
                        reply_to=message.get('message_id'),
                        reply_markup=reply_main_keyboard(role))
                    _clear_user_state(key)
                else:
                    _set_user_state(key, "admin_mode")
                    send_message(chat_id,
                        "❌ Команда больше не актуальна. Попробуйте снова.",
                        reply_to=message.get('message_id'),
                        reply_markup=admin_mode_keyboard())
            elif text_clean.lower() in ("❌ нет", "нет", "no", "н"):
                _set_user_state(key, "admin_mode")
                send_message(chat_id,
                    "🔄 Хорошо, давайте уточним.\n\n"
                    "Опишите задачу по изменению реестра в свободной форме.",
                    reply_to=message.get('message_id'),
                    reply_markup=admin_mode_keyboard())
            else:
                send_message(chat_id, "❓ Нажмите <b>✅ Да</b> или <b>❌ Нет</b>.",
                             reply_markup=confirm_keyboard())
            continue

        elif state and state.get("state") == "admin_mode" and role == "admin":
            command_text = llm.interpret_free_text(
                text, now_msk().strftime("%d.%m.%Y"), cfg, log_fn=log)
            if command_text:
                check = commands.parse_canonical(command_text,
                                                  today=now_msk().date())
                if check.ok and check.name != "help":
                    _set_user_state(key, "admin_mode_confirm", {
                        "command_text": command_text
                    })
                    send_message(chat_id,
                        "📝 <b>Я понял задачу так:</b>\n"
                        f"<code>{html.escape(command_text)}</code>\n\n"
                        "Всё верно?",
                        reply_to=message.get('message_id'),
                        reply_markup=confirm_keyboard())
                else:
                    send_message(chat_id, with_footer(
                        "🤔 Не удалось интерпретировать запрос. Попробуйте переформулировать."),
                        reply_markup=admin_mode_keyboard())
            else:
                send_message(chat_id, with_footer(
                    "🤔 Не удалось интерпретировать запрос. Попробуйте переформулировать."),
                    reply_markup=admin_mode_keyboard())
            continue

        elif state:
            _clear_user_state(key)
            # После очистки неизвестного состояния отправляем приветствие, а не в LLM
            send_message(chat_id, greeting_text(first_name, role),
                         reply_markup=reply_main_keyboard(role))
            continue

        # --- разбор команды (только для обычных пользователей) ---
        cmd = commands.parse(text, role=role, today=now_msk().date())

        if not cmd.ok:
            send_message(chat_id, greeting_text(first_name, role),
                         reply_to=message.get('message_id'),
                         reply_markup=reply_main_keyboard(role))
            continue

        if cmd.name == "help":
            send_message(chat_id, commands.help_text(role),
                         reply_to=message.get('message_id'),
                         reply_markup=reply_main_keyboard(role))
            continue

        try:
            response = dispatch(cmd, username, first_name, chat_id, key, user_id)
        except Exception as e:
            log(f"⚠️ Ошибка выполнения команды {cmd.name}: {e}")
            response = "❌ Внутренняя ошибка при выполнении команды."

        send_message(chat_id, response, reply_to=message.get('message_id'))


# ======== ОСНОВНОЙ ЦИКЛ ========

def main_loop():
    log("🤖 Бот v3.1 запущен. Личка для всех (кнопки), группа — рассылки + "
        "сбор /идея /баг, LLM-режим для админов, переключение реестров, "
        f"дайджест в {load_config().get('digest_time', '20:47')} МСК.")
    load_user_states()

    threading.Thread(target=digest_loop, daemon=True).start()

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
                offset = updates[-1]['update_id'] + 1
                process_updates(updates)

            time.sleep(1)

        except KeyboardInterrupt:
            log("👋 Бот остановлен.")
            break
        except Exception as e:
            log(f"Ошибка основного цикла: {e}")
            time.sleep(5)


if __name__ == '__main__':
    main_loop()
