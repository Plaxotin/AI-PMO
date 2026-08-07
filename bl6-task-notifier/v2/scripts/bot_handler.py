#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Бот @Plaxotin_task_bot — «Администратор поручений», v2.0.

Текстовые команды без inline-кнопок (парсер — commands.py),
роли (суперадмин/админ), антифлуд, аудит-лог в Google Sheets,
вечерний дайджест изменений, кэш чтения реестра.

Long polling и tg_api — как в v1.0 (проверенная связка).
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


def send_message(chat_id, text: str, reply_to: int = None) -> bool:
    """Отправляет сообщение (длинное — частями)."""
    ok = True
    for part in _split_message(text):
        payload = {'chat_id': chat_id, 'text': part, 'parse_mode': 'HTML',
                   'disable_web_page_preview': True}
        if reply_to:
            payload['reply_to_message_id'] = reply_to
        ok = tg_api('sendMessage', payload).get('ok', False) and ok
    return ok


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

        # Минутный лимит (для групп; админов в личке не душим поминутно)
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
    """Получает все поручения из реестра (с кэшем TTL 60 с)."""
    if not force and time.time() - _tasks_cache["ts"] < _CACHE_TTL:
        return _tasks_cache["data"]

    success, output = run_task_manager('list')
    if not success:
        return _tasks_cache["data"]  # отдаём устаревший кэш, лучше чем ничего

    tasks = []
    for line in output.split('\n'):
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


def _get_spreadsheet():
    import gspread
    from google.oauth2.service_account import Credentials

    creds_file = os.path.join(CREDS_DIR, 'gsheets-service-account.json')
    scopes = ['https://www.googleapis.com/auth/spreadsheets',
              'https://www.googleapis.com/auth/drive']
    creds = Credentials.from_service_account_file(creds_file, scopes=scopes)
    client = gspread.authorize(creds)
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


# ======== ЧАТЫ АДМИНОВ (для вечернего дайджеста) ========

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

def format_task_list(tasks: List[Dict], title: str) -> str:
    if not tasks:
        return f"📭 {title}\n\nПоручений не найдено."

    lines = [f"<b>{title}</b> ({len(tasks)} шт.)\n"]
    for task in tasks:
        status_emoji = {
            "Новое": "🆕", "В работе": "🔵", "На проверке": "🟡",
            "Выполнено": "✅", "Отменено": "❌", "Просрочено": "🔴",
        }.get(task.get('status', ''), "⚪")
        desc = task.get('description', '')
        desc_short = desc[:60] + "…" if len(desc) > 60 else desc
        project = task.get('project', 'Без проекта')
        project_short = project[:20] + "…" if len(project) > 20 else project
        lines.append(
            f"<b>#{task.get('id', '?')}</b> {status_emoji} <b>{task.get('status', '?')}</b>\n"
            f"   📁 {html.escape(project_short)}\n"
            f"   📝 {html.escape(desc_short)}\n"
            f"   👤 {html.escape(task.get('assignee', '?'))}  📅 {task.get('deadline', '?')}\n"
        )
    return "\n".join(lines)


# ======== ОБРАБОТЧИКИ КОМАНД ========

def cmd_list_my(username: str) -> str:
    assignee = get_assignee_by_telegram(username)
    if not assignee:
        return (f"❓ Не удалось определить ваше имя в реестре.\n"
                f"   Ваш Telegram: @{username}\n\n"
                f"   Добавьте соответствие в файл user_mapping.json")
    filtered = [t for t in get_all_tasks()
                if assignee.lower() in t.get('assignee', '').lower()
                and t.get('status') not in ("Выполнено", "Отменено")]
    return format_task_list(filtered, f"📋 Мои поручения — {assignee}")


def cmd_list_all() -> str:
    return format_task_list(get_all_tasks(), "📋 Все поручения")


def cmd_list_project(project: str) -> str:
    filtered = [t for t in get_all_tasks()
                if project.lower() in t.get('project', '').lower()]
    return format_task_list(filtered, f"📋 Поручения проекта «{project}»")


def cmd_list_status(status: str) -> str:
    filtered = [t for t in get_all_tasks()
                if status.lower() in t.get('status', '').lower()]
    return format_task_list(filtered, f"📋 Поручения со статусом «{status}»")


def cmd_close_task(task_id: int, username: str) -> str:
    """Закрытие своего поручения (проверка по user_mapping)."""
    assignee = get_assignee_by_telegram(username)
    if not assignee:
        return "❌ Не удалось определить ваше имя в реестре (user_mapping.json)."

    task = get_task_info(task_id)
    if not task:
        return f"❌ Поручение <b>#{task_id}</b> не найдено."

    if assignee.lower() not in task.get('assignee', '').lower():
        return (f"❌ Поручение <b>#{task_id}</b> назначено на <b>{html.escape(task['assignee'])}</b>.\n"
                f"   Вы ({html.escape(assignee)}) не можете его закрыть.")

    success, output = run_task_manager('update', str(task_id), '--status', 'Выполнено')
    if success:
        invalidate_cache()
        audit("close", task_id, f"Статус → Выполнено ({assignee})", username)
        return (f"✅ Поручение <b>#{task_id}</b> закрыто!\n\n"
                f"   📝 {html.escape(task.get('description', ''))}\n"
                f"   📅 Дата закрытия: {now_msk().strftime('%d.%m.%Y')}")
    return f"❌ Не удалось закрыть #{task_id}.\n<code>{html.escape(output[:200])}</code>"


def cmd_create_preview(args: Dict, username: str) -> str:
    return (
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
        return (f"✅ Поручение <b>#{new_id or '?'}</b> создано!\n\n"
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
        return (f"✅ Поручение <b>#{task_id}</b>: {action_label}.\n\n"
                f"   📝 {html.escape(task.get('description', ''))}")
    return f"❌ Не удалось обновить #{task_id}.\n<code>{html.escape(output[:200])}</code>"


def cmd_delete_execute(task_id: int, username: str) -> str:
    task = get_task_info(task_id)
    success, output = run_task_manager('delete', str(task_id))
    if success:
        invalidate_cache()
        desc = task.get('description', '') if task else ''
        audit("delete", task_id, f"Удалено: {desc[:100]}", username)
        return f"🗑 Поручение <b>#{task_id}</b> удалено."
    return f"❌ Не удалось удалить #{task_id}.\n<code>{html.escape(output[:200])}</code>"


def cmd_digest() -> str:
    """Ручной дайджест дедлайнов (check-deadlines также шлёт сводку в общий чат)."""
    success, output = run_task_manager('check-deadlines')
    return output.strip() if output.strip() else ("✅ Готово." if success else "❌ Ошибка check-deadlines")


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
    return f"✅ Лимиты обновлены: {per_min} команд/мин, {per_day} команд/день (группы)."


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
    action_emoji = {"create": "➕", "close": "✅", "update": "✏️", "delete": "🗑"}
    lines = [f"📊 <b>Изменения реестра за {today}</b> ({len(entries)})\n"]
    for row in entries:
        row = list(row) + [""] * (5 - len(row))
        ts, user, action, task_id, details = row[:5]
        time_part = ts.split(" ")[1][:5] if " " in ts else ts
        emoji = action_emoji.get(action, "•")
        lines.append(f"{emoji} {time_part} {html.escape(user)} "
                     f"<b>{html.escape(action)}</b> #{html.escape(task_id)}"
                     + (f" — {html.escape(details[:120])}" if details else ""))
    return "\n".join(lines)


def digest_loop():
    """Фоновый поток: раз в 30 с проверяет, не пора ли отправить дайджест (МСК)."""
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
                    if not chat_ids:
                        log("⚠️ Дайджест готов, но chat_id админов неизвестны "
                            "(админы должны хоть раз написать боту в личку)")
                    for cid in chat_ids:
                        send_message(cid, text)
                    log(f"Вечерний дайджест отправлен {len(chat_ids)} админам")
                else:
                    log("Вечерний дайджест: изменений за день нет, не отправляю")
        except Exception as e:
            log(f"⚠️ Ошибка в digest_loop: {e}")
        time.sleep(30)


# ======== DISPATCH ========

def dispatch(cmd: "commands.ParsedCommand", username: str, first_name: str,
             chat_id, key: str) -> str:
    """Выполняет распознанную команду и возвращает текст ответа."""
    cfg = load_config()
    name, args = cmd.name, cmd.args

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


# ======== ОБРАБОТКА ОБНОВЛЕНИЙ ========

def process_updates(updates: List[Dict]):
    for update in updates:
        message = update.get('message')
        if not message:
            continue  # callback_query и прочее игнорируем — кнопок больше нет

        text = message.get('text', '')
        if not text:
            continue

        chat = message.get('chat', {})
        chat_id = chat.get('id')
        is_private = chat.get('type') == 'private'

        from_user = message.get('from', {})
        username = from_user.get('username', '')
        first_name = from_user.get('first_name', '')
        user_id = from_user.get('id')
        key = _state_key(chat_id, user_id)

        cfg = load_config()
        role = resolve_role(username, cfg)
        chat_type = "private" if is_private else "group"

        # --- личка: доступ только админам/суперадмину ---
        if is_private:
            if role == "user":
                log(f"Игнор лички от неавторизованного @{username} ({user_id}): {text[:100]}")
                continue
            remember_admin_chat(username, chat_id)
        else:
            # --- группа: только сообщения с упоминанием бота ---
            mention = f'@{BOT_USERNAME}'
            if mention not in text:
                continue
            text = text.replace(mention, '').strip()
            if not text:
                send_message(chat_id, commands.help_text("user", "group"),
                             reply_to=message.get('message_id'))
                continue

        # --- антифлуд ---
        allowed, warning = flood.check(user_id, role, cfg["limits"])
        if not allowed:
            if warning:
                send_message(chat_id, warning, reply_to=message.get('message_id'))
            log(f"Антифлуд: @{username} ({user_id}) заблокирован")
            continue

        # --- ожидающее подтверждение (да/отмена) ---
        state = _get_user_state(key)
        if state:
            _clear_user_state(key)
            if text.strip().lower() == "да":
                if state["state"] == "confirm_create":
                    response = cmd_create_execute(state["data"], username, first_name)
                elif state["state"] == "confirm_delete":
                    response = cmd_delete_execute(state["data"]["id"], username)
                else:
                    response = "❌ Неизвестное состояние, отменено."
            else:
                response = "❌ Отменено."
            send_message(chat_id, response, reply_to=message.get('message_id'))
            continue

        # --- разбор и выполнение команды ---
        cmd = commands.parse(text, role=role, chat_type=chat_type,
                             today=now_msk().date())
        if not cmd.ok:
            response = cmd.error
        elif cmd.name == "help":
            response = commands.help_text(role, chat_type)
        else:
            try:
                response = dispatch(cmd, username, first_name, chat_id, key)
            except Exception as e:
                log(f"⚠️ Ошибка выполнения команды {cmd.name}: {e}")
                response = f"❌ Внутренняя ошибка при выполнении команды."

        send_message(chat_id, response, reply_to=message.get('message_id'))


# ======== ОСНОВНОЙ ЦИКЛ (как в v1.0) ========

def main_loop():
    log("🤖 Бот v2.0 запущен. Текстовые команды, роли, антифлуд, дайджест "
        f"в {load_config().get('digest_time', '20:47')} МСК.")

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
