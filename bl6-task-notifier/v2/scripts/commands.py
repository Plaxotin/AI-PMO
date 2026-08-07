#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Парсер текстовых команд бота @Plaxotin_task_bot (BL-6, v2.0).

Чистая логика без сети и ввода-вывода:
  вход  — текст сообщения, роль пользователя, тип чата;
  выход — структура ParsedCommand (имя команды + аргументы) или понятная ошибка.

Роли:    "user" | "admin" | "superadmin"
Тип чата: "group" | "private"
"""

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Dict, Optional, Tuple


# ======== РЕЗУЛЬТАТ РАЗБОРА ========

@dataclass
class ParsedCommand:
    """Результат разбора команды."""
    ok: bool
    name: str = ""                  # 'list_my', 'close', 'create', ...
    args: Dict = field(default_factory=dict)
    error: str = ""                 # текст для пользователя, если ok=False


# ======== УМНЫЕ ДАТЫ ========

_WEEKDAYS = {
    "понедельник": 0,
    "вторник": 1,
    "среда": 2, "среду": 2,
    "четверг": 3,
    "пятница": 4, "пятницу": 4,
    "суббота": 5, "субботу": 5,
    "воскресенье": 6,
}

_DATE_ERROR = (
    "Не понял дату «{value}».\n"
    "Форматы: <code>20.08.2026</code>, <code>20.08</code>, "
    "<code>завтра</code>, <code>послезавтра</code>, <code>в пятницу</code>."
)


def normalize_date(text: str, today: Optional[date] = None) -> Optional[str]:
    """Нормализует дату в формат ДД.ММ.ГГГГ.

    Понимает: завтра, послезавтра, сегодня, в <день недели>,
    ДД.ММ, ДД.ММ.ГГГГ (и ДД.ММ.ГГ).

    `today` — дата «сегодня» (в МСК); параметр нужен для тестов.
    Возвращает None, если дату распознать не удалось.
    """
    if today is None:
        today = date.today()

    s = text.strip().lower()

    if s == "сегодня":
        return today.strftime("%d.%m.%Y")
    if s == "завтра":
        return (today + timedelta(days=1)).strftime("%d.%m.%Y")
    if s == "послезавтра":
        return (today + timedelta(days=2)).strftime("%d.%m.%Y")

    # "в пятницу" / "во вторник" — ближайший такой день недели (включая сегодня)
    m = re.match(r"^(?:в|во)\s+([а-яё]+)$", s)
    if m and m.group(1) in _WEEKDAYS:
        target = _WEEKDAYS[m.group(1)]
        delta = (target - today.weekday()) % 7
        return (today + timedelta(days=delta)).strftime("%d.%m.%Y")

    # Числовые форматы: ДД.ММ[.ГГ[ГГ]]
    m = re.match(r"^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$", s)
    if m:
        day, month = int(m.group(1)), int(m.group(2))
        if m.group(3):
            year = int(m.group(3))
            if year < 100:
                year += 2000
        else:
            # Год не указан: текущий, а если дата уже прошла — следующий
            year = today.year
            try:
                if date(year, month, day) < today:
                    year += 1
            except ValueError:
                return None
        try:
            return date(year, month, day).strftime("%d.%m.%Y")
        except ValueError:
            return None

    return None


# ======== СПРАВКА ========

def help_text(role: str = "user", chat_type: str = "group") -> str:
    """Краткая справка по командам с учётом роли и контекста."""
    lines = [
        "Вот что я умею:",
        "",
        "📋 <b>мои поручения</b> — ваши активные поручения",
        "📋 <b>все поручения</b> — полный список",
        "📋 <b>поручения &lt;проект&gt;</b> — фильтр по проекту",
        "📋 <b>поручения статус &lt;статус&gt;</b> — фильтр по статусу",
        "✅ <b>закрыть #N</b> — закрыть своё поручение",
        "➕ <b>создать поручение: Проект=…; Описание=…; Ответственный=…; Срок=…</b>",
    ]
    if role in ("admin", "superadmin") and chat_type == "private":
        lines += [
            "",
            "<b>Администрирование реестра (личка):</b>",
            "📅 <b>срок #N &lt;дата&gt;</b>",
            "🔄 <b>статус #N &lt;статус&gt;</b>",
            "👤 <b>ответственный #N &lt;имя&gt;</b>",
            "📝 <b>описание #N &lt;текст&gt;</b>",
            "💬 <b>комментарий #N &lt;текст&gt;</b>",
            "🗑 <b>удалить #N</b>",
            "📊 <b>дайджест</b> — дайджест дедлайнов",
        ]
    if role == "superadmin" and chat_type == "private":
        lines += [
            "",
            "<b>Конфигурация (суперадмин):</b>",
            "➕ <b>добавить админа @user</b> / ➖ <b>убрать админа @user</b>",
            "👥 <b>админы</b>",
            "🚦 <b>лимиты &lt;в-минуту&gt; &lt;в-день&gt;</b>",
            "🗂 <b>версии</b> / <b>откатить конфиг &lt;версия&gt;</b>",
        ]
    return "\n".join(lines)


def unknown_command(role: str = "user", chat_type: str = "group") -> ParsedCommand:
    return ParsedCommand(
        ok=False,
        error="🤔 Не понял команду.\n\n" + help_text(role, chat_type),
    )


# ======== РАЗБОР КОМАНДЫ СОЗДАНИЯ ========

_CREATE_FIELDS = {
    "проект": "project",
    "описание": "description",
    "ответственный": "assignee",
    "срок": "deadline",
}
_CREATE_REQUIRED = ["project", "description", "assignee", "deadline"]
_CREATE_LABELS = {
    "project": "Проект",
    "description": "Описание",
    "assignee": "Ответственный",
    "deadline": "Срок",
}


def _parse_create(payload: str, today: Optional[date]) -> ParsedCommand:
    """Разбирает тело команды «создать поручение: …»."""
    if not payload.strip():
        return ParsedCommand(
            ok=False,
            error=(
                "❌ Укажите поля поручения.\n\n"
                "Формат:\n"
                "<code>создать поручение: Проект=…; Описание=…; "
                "Ответственный=…; Срок=…</code>"
            ),
        )

    fields: Dict[str, str] = {}
    for part in payload.split(";"):
        part = part.strip()
        if not part:
            continue
        if "=" not in part:
            return ParsedCommand(
                ok=False,
                error=(
                    f"❌ Не понял фрагмент «{part}».\n"
                    f"Каждое поле задаётся как <code>Имя=Значение</code>, "
                    f"поля разделяются точкой с запятой."
                ),
            )
        key, _, value = part.partition("=")
        key_norm = key.strip().lower()
        if key_norm not in _CREATE_FIELDS:
            return ParsedCommand(
                ok=False,
                error=(
                    f"❌ Неизвестное поле «{key.strip()}».\n"
                    f"Допустимые поля: Проект, Описание, Ответственный, Срок."
                ),
            )
        fields[_CREATE_FIELDS[key_norm]] = value.strip()

    missing = [_CREATE_LABELS[f] for f in _CREATE_REQUIRED if not fields.get(f)]
    if missing:
        return ParsedCommand(
            ok=False,
            error=(
                f"❌ Не хватает обязательных полей: <b>{', '.join(missing)}</b>.\n\n"
                f"Формат:\n"
                f"<code>создать поручение: Проект=…; Описание=…; "
                f"Ответственный=…; Срок=…</code>"
            ),
        )

    deadline = normalize_date(fields["deadline"], today)
    if deadline is None:
        return ParsedCommand(ok=False, error=_DATE_ERROR.format(value=fields["deadline"]))
    fields["deadline"] = deadline

    return ParsedCommand(ok=True, name="create", args=fields)


# ======== ДОСТУП ========

# Команды, доступные всем (в группе — через упоминание)
_GROUP_COMMANDS = {"help", "list_my", "list_all", "list_project", "list_status",
                   "close", "create"}
# Команды админов (только личка)
_ADMIN_COMMANDS = {"deadline", "status", "assignee", "description", "comment",
                   "delete", "digest"}
# Команды суперадмина (только личка)
_SUPERADMIN_COMMANDS = {"add_admin", "remove_admin", "list_admins",
                        "set_limits", "versions", "rollback"}


def _check_access(name: str, role: str, chat_type: str) -> Optional[ParsedCommand]:
    """Проверяет, может ли пользователь выполнить команду здесь.

    Возвращает None, если доступ есть, иначе ParsedCommand с ошибкой.
    """
    if name in _GROUP_COMMANDS:
        return None

    if name in _ADMIN_COMMANDS:
        if chat_type != "private":
            return ParsedCommand(
                ok=False,
                error="🔒 Эта команда доступна только в личных сообщениях боту.",
            )
        if role not in ("admin", "superadmin"):
            return ParsedCommand(
                ok=False,
                error="🔒 Эта команда доступна только администраторам.",
            )
        return None

    if name in _SUPERADMIN_COMMANDS:
        if chat_type != "private":
            return ParsedCommand(
                ok=False,
                error="🔒 Эта команда доступна только в личных сообщениях боту.",
            )
        if role != "superadmin":
            return ParsedCommand(
                ok=False,
                error="🔒 Эта команда доступна только суперадминистратору.",
            )
        return None

    return None


# ======== ГЛАВНЫЙ РАЗБОР ========

def parse(text: str, role: str = "user", chat_type: str = "group",
          today: Optional[date] = None) -> ParsedCommand:
    """Разбирает текст команды.

    Args:
        text: текст сообщения (уже без упоминания бота).
        role: "user" | "admin" | "superadmin".
        chat_type: "group" | "private".
        today: дата «сегодня» (МСК), для тестов.

    Returns:
        ParsedCommand: ok=True и name/args, либо ok=False и error для ответа.
    """
    norm = re.sub(r"\s+", " ", (text or "").strip())
    low = norm.lower()

    if not norm:
        return unknown_command(role, chat_type)

    def finish(name: str, args: Dict) -> ParsedCommand:
        denial = _check_access(name, role, chat_type)
        if denial is not None:
            return denial
        return ParsedCommand(ok=True, name=name, args=args)

    def finish_admin_id(body_pattern: str, name: str, arg_name: str) -> Optional[ParsedCommand]:
        """Команды вида «<слово> #N <значение>»."""
        m = re.match(body_pattern, low)
        if not m:
            return None
        task_id, value = m.group(1), norm[m.start(2):].strip()
        # значение берём из исходного регистра: позиция группы 2 в norm
        m2 = re.match(body_pattern, norm, flags=re.IGNORECASE)
        if m2:
            value = m2.group(2).strip()
        if not value:
            return ParsedCommand(
                ok=False,
                error=f"❌ Укажите значение после номера поручения.",
            )
        return finish(name, {"id": int(task_id), arg_name: value})

    # --- справка ---
    if low in ("помощь", "справка", "команды", "help", "/start", "/help", "старт"):
        return finish("help", {})

    # --- просмотр ---
    if low == "мои поручения":
        return finish("list_my", {})
    if low in ("все поручения", "всё поручения", "все поручение"):
        return finish("list_all", {})

    m = re.match(r"^поручения\s+статус\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        return finish("list_status", {"status": m.group(1).strip()})

    m = re.match(r"^поручения\s+(.+)$", norm, flags=re.IGNORECASE)
    if m:
        return finish("list_project", {"project": m.group(1).strip()})

    # --- закрытие ---
    m = re.match(r"^закрыть\s*#\s*(\d+)$", low) or re.match(r"^закрыть\s+(\d+)$", low)
    if m:
        return finish("close", {"id": int(m.group(1))})

    # --- создание ---
    m = re.match(r"^создать\s+поручение\s*:?\s*(.*)$", norm, flags=re.IGNORECASE | re.DOTALL)
    if m:
        cmd = _parse_create(m.group(1), today)
        if not cmd.ok:
            return cmd
        return finish("create", cmd.args)

    # --- админские команды «<слово> #N <значение>» ---
    r = finish_admin_id(r"^срок\s*#\s*(\d+)\s+(.+)$", "deadline", "date")
    if r is None:
        r = finish_admin_id(r"^срок\s+(\d+)\s+(.+)$", "deadline", "date")
    if r is not None:
        if r.ok:
            normalized = normalize_date(r.args["date"], today)
            if normalized is None:
                return ParsedCommand(ok=False, error=_DATE_ERROR.format(value=r.args["date"]))
            r.args["date"] = normalized
        return r

    r = finish_admin_id(r"^статус\s*#\s*(\d+)\s+(.+)$", "status", "status")
    if r is None:
        r = finish_admin_id(r"^статус\s+(\d+)\s+(.+)$", "status", "status")
    if r is not None:
        return r

    r = finish_admin_id(r"^ответственный\s*#\s*(\d+)\s+(.+)$", "assignee", "assignee")
    if r is None:
        r = finish_admin_id(r"^ответственный\s+(\d+)\s+(.+)$", "assignee", "assignee")
    if r is not None:
        return r

    r = finish_admin_id(r"^описание\s*#\s*(\d+)\s+(.+)$", "description", "description")
    if r is None:
        r = finish_admin_id(r"^описание\s+(\d+)\s+(.+)$", "description", "description")
    if r is not None:
        return r

    r = finish_admin_id(r"^комментарий\s*#\s*(\d+)\s+(.+)$", "comment", "comment")
    if r is None:
        r = finish_admin_id(r"^комментарий\s+(\d+)\s+(.+)$", "comment", "comment")
    if r is not None:
        return r

    # --- удаление ---
    m = re.match(r"^удалить\s*#\s*(\d+)$", low) or re.match(r"^удалить\s+(\d+)$", low)
    if m:
        return finish("delete", {"id": int(m.group(1))})

    # --- дайджест ---
    if low == "дайджест":
        return finish("digest", {})

    # --- управление админами ---
    m = re.match(r"^добавить\s+админа\s+@?([A-Za-z0-9_]+)$", low)
    if m:
        return finish("add_admin", {"username": m.group(1)})

    m = (re.match(r"^(?:убрать|удалить)\s+админа\s+@?([A-Za-z0-9_]+)$", low))
    if m:
        return finish("remove_admin", {"username": m.group(1)})

    if low == "админы":
        return finish("list_admins", {})

    # --- лимиты ---
    m = re.match(r"^лимиты\s+(\d+)\s+(\d+)$", low)
    if m:
        return finish("set_limits", {"per_min": int(m.group(1)), "per_day": int(m.group(2))})

    # --- версии ---
    if low == "версии":
        return finish("versions", {})

    m = re.match(r"^откатить\s+конфиг\s+([A-Za-z0-9.\-_]+)$", low)
    if m:
        return finish("rollback", {"version": m.group(1)})

    return unknown_command(role, chat_type)
