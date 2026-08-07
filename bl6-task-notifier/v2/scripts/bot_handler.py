#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Бот @Plaxotin_task_bot — «Администратор поручений», v2.1.

Модель v2.1:
  - Групповой чат: бот НЕ реагирует на сообщения. Группа получает только
    автоматические рассылки (утренний дайджест дедлайнов через check-deadlines,
    вечерний дайджест изменений в 20:47 МСК).
  - Личка — для всех: обычным пользователям приветствие + inline-кнопки
    «📋 Мои поручения» / «✅ Закрыть поручение» (закрытие в один тап),
    админам — ещё и все текстовые команды, суперадмину — конфигурация.

Сохранено из v2.0: роли, антифлуд (токен-бакет), аудит-лог (лист «Лог»),
кэш чтения TTL 60 с, умные даты, защита от дублей, версии конфигурации.

Long polling и tg_api — как в v1.0/v2.0 (проверенная связка).
"""

import html
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import commands
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

TASK_HEADERS = ["ID", "Дата создания", "Автор/Источник", "Проект", "Описание",
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
    cfg.setdefault("superadmin", "plaxotin")
    cfg.setdefault("admins", [cfg["superadmin"]])
    limits = dict(DEFAULT_LIMITS)
    limits.update(cfg.get("limits") or {})
    cfg["limits"] = limits
    cfg.setdefault("digest_time", "20:47")
    return cfg


def save_config(cfg: Dict):
    os.makedirs(CREDS_DIR, exist_ok=True)
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def resolve_role(username: str, cfg: Dict) -> str:
    """Определяет роль по Telegram username (регистронезависимо)."""
    uname = (username or "").lstrip('@').lower()
    if not uname:
        return "user"
    if uname == str(cfg.get("superadmin", "")).lower():
        return "superadmin"
    if uname in [str(a).lower() for a in cfg.get("admins", [])]:
        return "admin"
    return "user"


def registry_link() -> str:
    sid = load_config().get('spreadsheet_id', '')
    return f"https://docs.google.com/spreadsheets/d/{sid}/edit"


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
    # read timeout должен быть больше long-poll timeout, иначе гонка → "Read timed out"
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


# ======== INLINE-КЛАВИАТУРЫ (v2.1, минимальные) ========

def main_keyboard() -> Dict:
    return {"inline_keyboard": [[
        {"text": "📋 Мои поручения", "callback_data": "my_tasks"},
        {"text": "✅ Закрыть поручение", "callback_data": "close_menu"},
    ]]}


# ======== АНТИФЛУД (токен-бакет в памяти процесса) ========

class FloodControl:
    """Лимиты: N команд/мин и M команд/день на пользователя, глобальный потолок в день.

    Первое превышение окна → одно предупреждение; дальше — молчаливый игнор
    до конца окна.
    """

    def __init__(self):
        self._minute: Dict[str, Dict] = {}   # user_id -> {window_start, count, warned}
        self._day: Dict[str, Dict] = {}      # user_id -> {date, count, warned}
        self._global = {"date": "", "count": 0, "warned": False}

    def check(self, user_id: int, role: str, limits: Dict) -> Tuple[bool, Optional[str]]:
        """Возвращает (разрешено, текст предупреждения или None)."""
        uid = str(user_id)
        now = time.time()
        today = now_msk().strftime("%d.%m.%Y")

        # Глобальный потолок
        if self._global["date"] != today:
            self._global = {"date": today, "count": 0, "warned": False}
        if self._global["count"] >= limits["global_day"]:
            warn = None
            if not self._global["warned"]:
                self._global["warned"] = True
                warn = "⚠️ Бот сегодня перегружен (глобальный лимит команд). Попробуйте завтра."
            return False, warn
        self._global["count"] += 1

        # Дневной лимит пользователя
        day_limit = limits["admin_per_day"] if role in ("admin", "superadmin") else limits["per_day"]
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

        # Минутный лимит (для обычных пользователей; админов не душим поминутно)
        if role not in ("admin", "superadmin"):
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
    """Получает все поручения из реестра (с кэшем TTL 60 с).

    Основной путь — `list --json` (полные поля без обрезки, включая источник).
    Fallback — разбор текстового вывода `list` (обрезанного).
    """
    if not force and time.time() - _tasks_cache["ts"] < _CACHE_TTL:
        return _tasks_cache["data"]

    success, output = run_task_manager('list', '--json')
    tasks: List[Dict] = []
    if success:
        try:
            tasks = json.loads(output.strip())
        except json.JSONDecodeError:
            success = False  # ушли в fallback

    if not success:
        success2, output2 = run_task_manager('list')
        if not success2:
            return _tasks_cache["data"]  # отдаём устаревший кэш, лучше чем ничего
        tasks = []
        for line in output2.split('\n'):
            line = line.strip()
            if not line or line.startswith('Найдено') or line.startswith('ID') or line.startswith('-'):
                continue
            # Формат: ID Статус Срок Контрагент Ответственный Описание
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


def get_assignee_by_telegram(username: str) -> Optional[str]:
    mapping = load_user_mapping()
    username_clean = (username or "").lstrip('@').lower()
    for name, tg in mapping.items():
        if str(tg).lstrip('@').lower() == username_clean:
            return name
    return None


# ======== АУДИТ-ЛОГ (лист «Лог» в той же таблице) ========

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
    spreadsheet_id = load_config().get('spreadsheet_id')
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
    """Пишет строку в аудит-лог. Ошибки глотаем с логом — не роняем команду."""
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
    """Читает все строки аудит-лога (без заголовка)."""
    try:
        ws = _get_audit_sheet()
        values = ws.get_all_values()
        return values[1:] if len(values) > 1 else []
    except Exception as e:
        log(f"⚠️ Не удалось прочитать аудит-лог: {e}")
        return []


def find_recent_duplicate(project: str, description: str, minutes: int = 10) -> Optional[List[str]]:
    """Ищет create-запись с теми же проектом+описанием за последние N минут."""
    cutoff = now_msk() - timedelta(minutes=minutes)
    for row in reversed(read_audit_entries()):
        if len(row) < 5 or row[2] != "create":
            continue
        try:
            ts = datetime.strptime(row[0], "%d.%m.%Y %H:%M:%S").replace(tzinfo=MSK)
        except ValueError:
            continue
        if ts < cutoff:
            break  # лог хронологический, дальше только старее
        # details формата: "Проект=… | Описание=… | Ответственный=… | Срок=…"
        parts = dict(p.split("=", 1) for p in (row[4] or "").split(" | ") if "=" in p)
        if (parts.get("Проект", "").strip().lower() == project.strip().lower()
                and parts.get("Описание", "").strip().lower() == description.strip().lower()):
            return row
    return None


# ======== ЧАТЫ АДМИНОВ (fallback для дайджеста) ========

def remember_admin_chat(username: str, chat_id):
    """Запоминает chat_id админа (Telegram не позволяет писать по username)."""
    if not username:
        return
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
    usernames = {str(cfg.get("superadmin", "")).lower()}
    usernames.update(str(a).lower() for a in cfg.get("admins", []))
    chat_ids = []
    for uname in usernames:
        cid = data.get(uname)
        if cid and cid not in chat_ids:
            chat_ids.append(cid)
    return chat_ids


def get_group_chat_id() -> Optional[int]:
    """chat_id общего чата из telegram.json — цель автоматических рассылок."""
    try:
        return load_telegram_config().get('chat_id')
    except Exception:
        return None


# ======== СОСТОЯНИЯ (подтверждения) ========
# Ключ — "chat_id:user_id"; живут только подтверждения создания/удаления.
_user_states: Dict[str, Dict] = {}
CONFIRM_TIMEOUT = 60  # секунд


def _state_key(chat_id, user_id) -> str:
    return f"{chat_id}:{user_id}"


def _set_user_state(key: str, state: str, data: Dict = None):
    _user_states[key] = {"state": state, "data": data or {}, "ts": time.time()}


def _get_user_state(key: str) -> Optional[Dict]:
    st = _user_states.get(key)
    if st and time.time() - st.get("ts", 0) > CONFIRM_TIMEOUT:
        _user_states.pop(key, None)
        return None
    return st


def _clear_user_state(key: str):
    _user_states.pop(key, None)


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
            f"   📁 {html.escape(task.get('project') or 'Без проекта')}  "
            f"👤 {html.escape(task.get('assignee', '?'))}  "
            f"📣 {html.escape(task.get('author') or '?')}\n"
        )
    return "\n".join(lines)


# ======== КНОПОЧНЫЙ СЦЕНАРИЙ ПОЛЬЗОВАТЕЛЯ ========

def get_open_tasks_for(username: str) -> Tuple[Optional[str], List[Dict]]:
    """(имя в реестре или None, его открытые поручения)."""
    assignee = get_assignee_by_telegram(username)
    if not assignee:
        return None, []
    tasks = [t for t in get_all_tasks()
             if assignee.lower() in t.get('assignee', '').lower()
             and t.get('status') not in ("Выполнено", "Отменено")]
    return assignee, tasks


def build_my_tasks_view(username: str) -> Tuple[str, Optional[Dict]]:
    """Текст + клавиатура со списком открытых поручений (по кнопке на поручение)."""
    assignee, tasks = get_open_tasks_for(username)
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
            f"📁 {html.escape(t.get('project') or 'Без проекта')}  "
            f"📣 {html.escape(t.get('author') or '?')}"
        )
    text = with_footer(
        f"📋 <b>Ваши открытые поручения</b> ({len(tasks)}) — {html.escape(assignee)}\n\n"
        + "\n\n".join(blocks)
        + "\n\nНажмите на поручение ниже, чтобы закрыть его."
    )
    return text, {"inline_keyboard": buttons}


def handle_close_callback(task_id: int, username: str) -> Tuple[str, bool]:
    """Закрытие поручения по кнопке. Возвращает (текст для тоста, успех).

    Проверка владельца по user_mapping — защита от подделки callback_data.
    """
    assignee = get_assignee_by_telegram(username)
    if not assignee:
        return "❌ Вы не найдены в реестре, обратитесь к администратору.", False

    task = get_task_info(task_id)
    if not task:
        return f"❌ Поручение #{task_id} не найдено (уже удалено?).", False

    if assignee.lower() not in task.get('assignee', '').lower():
        log(f"⚠️ @{username} попытался закрыть чужое поручение #{task_id} "
            f"(ответственный: {task.get('assignee')})")
        return f"❌ #{task_id} — не ваше поручение ({task.get('assignee')}).", False

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

def cmd_list_my(username: str) -> str:
    assignee = get_assignee_by_telegram(username)
    if not assignee:
        return ("❓ Не удалось определить ваше имя в реестре.\n"
                "Обратитесь к администратору (user_mapping.json).")
    assignee_l, filtered = get_open_tasks_for(username)
    return with_footer(format_task_list(filtered, f"📋 Мои поручения — {assignee}"))


def cmd_list_all() -> str:
    return with_footer(format_task_list(get_all_tasks(), "📋 Все поручения"))


def cmd_list_project(project: str) -> str:
    filtered = [t for t in get_all_tasks()
                if project.lower() in t.get('project', '').lower()]
    return with_footer(format_task_list(filtered, f"📋 Поручения проекта «{project}»"))


def cmd_list_status(status: str) -> str:
    filtered = [t for t in get_all_tasks()
                if status.lower() in t.get('status', '').lower()]
    return with_footer(format_task_list(filtered, f"📋 Поручения со статусом «{status}»"))


def cmd_close_task(task_id: int, username: str) -> str:
    """Закрытие своего поручения текстом (проверка по user_mapping)."""
    toast, success = handle_close_callback(task_id, username)
    if success:
        return with_footer(toast)
    return toast


def cmd_create_preview(args: Dict, username: str) -> str:
    return with_footer(
        "📝 <b>Проверьте новое поручение:</b>\n\n"
        f"   📁 Проект: {html.escape(args['project'])}\n"
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
        '--project', args['project'],
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
              f"Проект={args['project']} | Описание={args['description']} | "
              f"Ответственный={args['assignee']} | Срок={args['deadline']}",
              username)
        return with_footer(
            f"✅ Поручение <b>#{new_id or '?'}</b> создано!\n\n"
            f"   📁 {html.escape(args['project'])}\n"
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
    """Ручной дайджест дедлайнов (check-deadlines также шлёт сводку в общий чат)."""
    success, output = run_task_manager('check-deadlines')
    return output.strip() if output.strip() else ("✅ Готово." if success else "❌ Ошибка check-deadlines")


def cmd_new_registry(title: str, username: str) -> str:
    """Создаёт новую Google-таблицу и переключает реестр на неё."""
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


def cmd_add_admin(cfg: Dict, username: str) -> str:
    uname = username.lstrip('@').lower()
    admins = [str(a).lower() for a in cfg.get("admins", [])]
    if uname in admins:
        return f"ℹ️ @{uname} уже в списке админов."
    cfg.setdefault("admins", []).append(uname)
    save_config(cfg)
    return f"✅ @{uname} добавлен в администраторы."


def cmd_remove_admin(cfg: Dict, username: str) -> str:
    uname = username.lstrip('@').lower()
    if uname == str(cfg.get("superadmin", "")).lower():
        return "❌ Нельзя убрать суперадминистратора."
    admins = [str(a).lower() for a in cfg.get("admins", [])]
    if uname not in admins:
        return f"ℹ️ @{uname} и так не в списке админов."
    cfg["admins"] = [a for a in cfg.get("admins", []) if str(a).lower() != uname]
    save_config(cfg)
    return f"✅ @{uname} убран из администраторов."


def cmd_list_admins(cfg: Dict) -> str:
    lines = [f"👑 Суперадминистратор: @{cfg.get('superadmin', '?')}", "", "👥 Администраторы:"]
    admins = cfg.get("admins", [])
    lines += [f"   • @{a}" for a in admins] if admins else ["   (пусто)"]
    return "\n".join(lines)


def cmd_set_limits(cfg: Dict, per_min: int, per_day: int) -> str:
    cfg.setdefault("limits", dict(DEFAULT_LIMITS))
    cfg["limits"]["per_min"] = per_min
    cfg["limits"]["per_day"] = per_day
    save_config(cfg)
    return f"✅ Лимиты обновлены: {per_min} команд/мин, {per_day} команд/день."


def cmd_versions() -> str:
    if not os.path.isdir(VERSIONS_DIR):
        return "📂 Каталог versions/ ещё не создан."
    current = ""
    current_file = os.path.join(VERSIONS_DIR, "CURRENT")
    if os.path.exists(current_file):
        with open(current_file, 'r', encoding='utf-8') as f:
            current = f.read().strip()
    versions = sorted(d for d in os.listdir(VERSIONS_DIR)
                      if os.path.isdir(os.path.join(VERSIONS_DIR, d)))
    lines = ["🗂 <b>Версии конфигурации:</b>"]
    for v in versions:
        mark = " ← текущая" if v == current else ""
        lines.append(f"   • <code>{v}</code>{mark}")
    lines.append("\nОткат: <code>откатить конфиг &lt;версия&gt;</code>")
    return "\n".join(lines)


def cmd_rollback(version: str) -> str:
    src = os.path.join(VERSIONS_DIR, version)
    if not os.path.isdir(src):
        return f"❌ Версия <code>{html.escape(version)}</code> не найдена. Смотрите «версии»."
    try:
        src_scripts = os.path.join(src, "scripts")
        if os.path.isdir(src_scripts):
            for fname in os.listdir(src_scripts):
                if fname.endswith(".py"):
                    shutil.copy2(os.path.join(src_scripts, fname),
                                 os.path.join(SCRIPT_DIR, fname))
        for fname in ("config.json", "user_mapping.json"):
            # в снапшотах файлы лежат в .credentials/ (как в v1.0), но
            # поддерживаем и вариант в корне снапшота
            candidates = [os.path.join(src, ".credentials", fname),
                          os.path.join(src, fname)]
            for fpath in candidates:
                if os.path.exists(fpath):
                    shutil.copy2(fpath, os.path.join(CREDS_DIR, fname))
                    break
        current_file = os.path.join(VERSIONS_DIR, "CURRENT")
        with open(current_file, 'w', encoding='utf-8') as f:
            f.write(version)
    except Exception as e:
        return f"❌ Ошибка отката: {html.escape(str(e))}"

    log(f"Откат конфигурации на {version}, перезапуск сервиса")

    def _restart():
        time.sleep(2)  # даём ответу уйти в Telegram
        subprocess.run(["systemctl", "restart", "plaxotin-task-bot"], timeout=30)

    threading.Thread(target=_restart, daemon=True).start()
    return (f"✅ Конфигурация откачена на <code>{html.escape(version)}</code>.\n"
            f"🔄 Перезапускаю сервис (пара секунд)…")


# ======== ВЕЧЕРНИЙ ДАЙДЖЕСТ ИЗМЕНЕНИЙ ========

def build_evening_digest() -> Optional[str]:
    """Сводка изменений реестра за сегодня (МСК). None, если изменений не было."""
    today = now_msk().strftime("%d.%m.%Y")
    entries = [r for r in read_audit_entries() if r and str(r[0]).startswith(today)]
    if not entries:
        return None
    action_emoji = {"create": "➕", "close": "✅", "update": "✏️", "delete": "🗑",
                    "new_registry": "🆕"}
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
    """Фоновый поток: раз в 30 с проверяет, не пора ли отправить дайджест (МСК).

    Получатели — админы в личку (требование владельца); fallback — общий чат,
    если ни один админ ещё не написал боту.
    Нет изменений за день — не отправляем.
    """
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
                            log("Вечерний дайджест отправлен в общий чат "
                                "(нет зарегистрированных личек админов)")
                else:
                    log("Вечерний дайджест: изменений за день нет, не отправляю")
        except Exception as e:
            log(f"⚠️ Ошибка в digest_loop: {e}")
        time.sleep(30)


# ======== ПРИВЕТСТВИЕ ========

def greeting_text(first_name: str, role: str) -> str:
    if role in ("admin", "superadmin"):
        # v2.2: короткое приветствие для админов — только компактный список команд
        return (
            f"👋 <b>Привет, {html.escape(first_name or 'друг')}!</b>\n\n"
            f"<b>Вот что я умею:</b>\n"
            f"📋 Кнопки «Мои поручения» / «Закрыть поручение» — список, закрытие в один тап\n"
            f"🔗 <b>реестр</b> — ссылка на таблицу\n"
            f"📋 <b>все поручения</b> / <b>поручения &lt;проект&gt;</b> / "
            f"<b>поручения статус &lt;статус&gt;</b>\n"
            f"➕ <b>создать поручение: Проект=…; Описание=…; Ответственный=…; Срок=…</b>\n"
            f"📅 <b>срок #N &lt;дата&gt;</b> · 🔄 <b>статус #N &lt;статус&gt;</b> · "
            f"👤 <b>ответственный #N &lt;имя&gt;</b>\n"
            f"📝 <b>описание #N &lt;текст&gt;</b> · 💬 <b>комментарий #N &lt;текст&gt;</b> · "
            f"🗑 <b>удалить #N</b>\n"
            f"📊 <b>дайджест</b> · 🆕 <b>новый реестр &lt;название&gt;</b>\n\n"
            f"💬 А ещё вы можете написать мне любую задачу по изменению реестра "
            f"поручений в свободной форме — я пойму и предложу подтверждение."
        )
    return (
        f"👋 <b>Привет, {html.escape(first_name or 'друг')}!</b>\n\n"
        f"Я бот реестра поручений.\n\n"
        f"📋 <b>Мои поручения</b> — ваши открытые задачи, закрытие в один тап\n"
        f"✅ <b>Закрыть поручение</b> — то же самое\n\n"
        f"Команда <b>реестр</b> — ссылка на таблицу."
    )


# ======== DISPATCH ========

def dispatch(cmd: "commands.ParsedCommand", username: str, first_name: str,
             chat_id, key: str) -> str:
    """Выполняет распознанную команду и возвращает текст ответа."""
    cfg = load_config()
    name, args = cmd.name, cmd.args

    if name == "registry_link":
        return f"📋 Реестр поручений:\n{registry_link()}"

    if name == "list_my":
        return cmd_list_my(username)
    if name == "list_all":
        return cmd_list_all()
    if name == "list_project":
        return cmd_list_project(args["project"])
    if name == "list_status":
        return cmd_list_status(args["status"])
    if name == "close":
        return cmd_close_task(args["id"], username)

    if name == "create":
        dup = find_recent_duplicate(args["project"], args["description"])
        if dup:
            return (f"⚠️ Похоже, такое поручение уже создавалось недавно "
                    f"(#{dup[3]}, {dup[0]}, {dup[1]}).\n"
                    f"Проект и описание совпадают — дубль не создаю. "
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

    if name == "add_admin":
        return cmd_add_admin(cfg, args["username"])
    if name == "remove_admin":
        return cmd_remove_admin(cfg, args["username"])
    if name == "list_admins":
        return cmd_list_admins(cfg)
    if name == "set_limits":
        return cmd_set_limits(cfg, args["per_min"], args["per_day"])
    if name == "versions":
        return cmd_versions()
    if name == "rollback":
        return cmd_rollback(args["version"])

    return "🤔 Не понял команду."


# ======== ОБРАБОТКА CALLBACK (inline-кнопки) ========

def process_callback(callback: Dict):
    callback_id = callback.get('id')
    data = callback.get('data', '')
    message = callback.get('message', {})
    chat = message.get('chat', {})
    chat_id = chat.get('id')
    message_id = message.get('message_id')

    from_user = callback.get('from', {})
    username = from_user.get('username', '')
    user_id = from_user.get('id')

    cfg = load_config()
    role = resolve_role(username, cfg)

    # Антифлуд и на кнопки
    allowed, warning = flood.check(user_id, role, cfg["limits"])
    if not allowed:
        answer_callback_query(callback_id, text=warning or "⏳ Лимит команд исчерпан.")
        log(f"Антифлуд (кнопка): @{username} ({user_id}) заблокирован")
        return

    if data in ("my_tasks", "close_menu", "refresh"):
        text, keyboard = build_my_tasks_view(username)
        if message_id:
            ok = edit_message(chat_id, message_id, text, reply_markup=keyboard)
            if not ok:
                send_message(chat_id, text, reply_markup=keyboard)
        else:
            send_message(chat_id, text, reply_markup=keyboard)
        answer_callback_query(callback_id)
        return

    if data.startswith("close:"):
        try:
            task_id = int(data.split(":", 1)[1])
        except ValueError:
            answer_callback_query(callback_id, text="❌ Некорректный номер.")
            return
        toast, success = handle_close_callback(task_id, username)
        answer_callback_query(callback_id, text=toast[:190])
        if success and message_id:
            # Обновляем список после закрытия
            text, keyboard = build_my_tasks_view(username)
            edit_message(chat_id, message_id, text, reply_markup=keyboard)
        return

    answer_callback_query(callback_id, text="❓ Неизвестная кнопка.")


# ======== ОБРАБОТКА ОБНОВЛЕНИЙ ========

def process_updates(updates: List[Dict]):
    for update in updates:
        # --- inline-кнопки ---
        if 'callback_query' in update:
            try:
                process_callback(update['callback_query'])
            except Exception as e:
                log(f"⚠️ Ошибка обработки callback: {e}")
            continue

        message = update.get('message')
        if not message:
            continue

        text = message.get('text', '')
        if not text:
            continue

        chat = message.get('chat', {})
        chat_id = chat.get('id')

        # --- группа: бот молчит (v2.1). Группа получает только рассылки. ---
        if chat.get('type') != 'private':
            continue

        from_user = message.get('from', {})
        username = from_user.get('username', '')
        first_name = from_user.get('first_name', '')
        user_id = from_user.get('id')
        key = _state_key(chat_id, user_id)

        cfg = load_config()
        role = resolve_role(username, cfg)

        if role in ("admin", "superadmin"):
            remember_admin_chat(username, chat_id)

        # --- антифлуд ---
        allowed, warning = flood.check(user_id, role, cfg["limits"])
        if not allowed:
            if warning:
                send_message(chat_id, warning, reply_to=message.get('message_id'))
            log(f"Антифлуд: @{username} ({user_id}) заблокирован")
            continue

        # --- ожидающее подтверждение (да/отмена) — только админские сценарии ---
        state = _get_user_state(key)
        if state and role in ("admin", "superadmin"):
            _clear_user_state(key)
            if text.strip().lower() == "да":
                if state["state"] == "confirm_create":
                    response = cmd_create_execute(state["data"], username, first_name)
                elif state["state"] == "confirm_delete":
                    response = cmd_delete_execute(state["data"]["id"], username)
                elif state["state"] == "confirm_llm":
                    # Исполняем LLM-интерпретацию через обычный путь:
                    # parse (проверки прав) → dispatch (аудит, кэш)
                    cmd2 = commands.parse(state["data"]["command_text"],
                                          role=role, today=now_msk().date())
                    if not cmd2.ok:
                        response = cmd2.error
                    elif cmd2.name == "help":
                        response = commands.help_text(role)
                    else:
                        try:
                            response = dispatch(cmd2, username, first_name, chat_id, key)
                        except Exception as e:
                            log(f"⚠️ Ошибка выполнения LLM-команды {cmd2.name}: {e}")
                            response = "❌ Внутренняя ошибка при выполнении команды."
                else:
                    response = "❌ Неизвестное состояние, отменено."
            else:
                response = "❌ Отменено."
            send_message(chat_id, response, reply_to=message.get('message_id'))
            continue
        elif state:
            _clear_user_state(key)

        # --- разбор команды ---
        cmd = commands.parse(text, role=role, today=now_msk().date())

        if not cmd.ok:
            # Маршрутизация нераспознанного текста (v2.2)
            if commands.route_unrecognized(role) == "llm":
                # Админ/суперадмин: свободная форма → Kimi → подтверждение
                command_text = llm.interpret_free_text(
                    text, now_msk().strftime("%d.%m.%Y"), log_fn=log)
                if command_text:
                    # Проверяем, что интерпретация вообще парсится и разрешена роли
                    check = commands.parse(command_text, role=role,
                                           today=now_msk().date())
                    if check.ok and check.name != "help":
                        _set_user_state(key, "confirm_llm",
                                        {"command_text": command_text})
                        send_message(
                            chat_id,
                            f"🤖 <b>Понял так:</b> <code>{html.escape(command_text)}</code>\n\n"
                            f"Выполнить? Напишите <b>да</b> (60 сек), "
                            f"любой другой текст — отмена.",
                            reply_to=message.get('message_id'))
                    else:
                        send_message(chat_id, cmd.error,
                                     reply_to=message.get('message_id'),
                                     reply_markup=main_keyboard())
                else:
                    send_message(chat_id, cmd.error,
                                 reply_to=message.get('message_id'),
                                 reply_markup=main_keyboard())
                continue
            # Обычный пользователь: сразу приветствие + кнопки
            send_message(chat_id, greeting_text(first_name, role),
                         reply_to=message.get('message_id'),
                         reply_markup=main_keyboard())
            continue

        if cmd.name == "help":
            send_message(chat_id, commands.help_text(role),
                         reply_to=message.get('message_id'),
                         reply_markup=main_keyboard())
            continue

        try:
            response = dispatch(cmd, username, first_name, chat_id, key)
        except Exception as e:
            log(f"⚠️ Ошибка выполнения команды {cmd.name}: {e}")
            response = "❌ Внутренняя ошибка при выполнении команды."

        send_message(chat_id, response, reply_to=message.get('message_id'))


# ======== ОСНОВНОЙ ЦИКЛ (как в v1.0/v2.0) ========

def main_loop():
    log("🤖 Бот v2.2 запущен. Личка для всех (кнопки), группа — только рассылки, "
        "LLM-режим для админов, "
        f"дайджест в {load_config().get('digest_time', '20:47')} МСК.")

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
