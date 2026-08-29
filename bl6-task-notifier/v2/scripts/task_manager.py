#!/usr/bin/env python3
"""
Основной скрипт управления реестром поручений.
"""

import argparse
import html
import os
import sys
import json
from datetime import datetime, timedelta, timezone

# Сервер в UTC, пользователи в МСК
MSK = timezone(timedelta(hours=3))
from typing import Optional, List, Dict

# Пути к конфигурации
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.join(SCRIPT_DIR, '..')
CREDS_DIR = os.path.join(SKILL_DIR, '.credentials')
CONFIG_PATH = os.path.join(CREDS_DIR, 'config.json')

def load_config() -> Dict:
    """Загружает конфигурацию."""
    if not os.path.exists(CONFIG_PATH):
        return {}
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_config(config: Dict):
    """Сохраняет конфигурацию."""
    os.makedirs(CREDS_DIR, exist_ok=True)
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

def get_active_registry() -> str:
    """Возвращает spreadsheet_id активного реестра из config."""
    config = load_config()
    registries = config.get("registries", [])
    for reg in registries:
        if reg.get("active"):
            return reg.get("id", "")
    # fallback на старую схему
    return config.get("spreadsheet_id", "")

def get_gsheets_client():
    """Создаёт клиент Google Sheets."""
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        print("❌ Установите библиотеки: pip install gspread google-auth")
        sys.exit(1)
    
    creds_file = os.path.join(CREDS_DIR, 'gsheets-service-account.json')
    if not os.path.exists(creds_file):
        print(f"[ОШИБКА] Файл credentials не найден: {creds_file}")
        print("   Запустите сначала: python scripts/setup_gsheets.py")
        sys.exit(1)
    
    scopes = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ]
    creds = Credentials.from_service_account_file(creds_file, scopes=scopes)
    return gspread.authorize(creds)

def get_or_create_spreadsheet(client, title: str = "Реестр поручений") -> str:
    """Получает или создаёт таблицу."""
    config = load_config()
    
    # Проверяем через активный реестр (новая схема)
    active_id = get_active_registry()
    if active_id:
        try:
            spreadsheet = client.open_by_key(active_id)
            print(f"[OK] Подключено к существующей таблице: {spreadsheet.title}")
            return active_id
        except Exception:
            print("[ВНИМАНИЕ] Сохранённая таблица недоступна, создаю новую...")
    elif 'spreadsheet_id' in config:
        # fallback на старую схему
        try:
            spreadsheet = client.open_by_key(config['spreadsheet_id'])
            print(f"[OK] Подключено к существующей таблице: {spreadsheet.title}")
            return config['spreadsheet_id']
        except Exception:
            print("[ВНИМАНИЕ] Сохранённая таблица недоступна, создаю новую...")
    
    # Создаем новую таблицу
    spreadsheet = client.create(title)
    worksheet = spreadsheet.sheet1
    
    # Заголовки
    headers = [
        "ID", "Дата создания", "Автор/Источник", "Контрагент",
        "Описание", "Ответственный", "Срок", "Статус",
        "Дата закрытия", "Комментарий"
    ]
    worksheet.update(range_name='A1:J1', values=[headers])
    
    # Форматирование заголовков
    worksheet.format('A1:J1', {
        'textFormat': {'bold': True},
        'backgroundColor': {'red': 0.9, 'green': 0.9, 'blue': 0.9}
    })
    
    spreadsheet_id = spreadsheet.id
    config['spreadsheet_id'] = spreadsheet_id
    save_config(config)
    
    print(f"[OK] Создана новая таблица: {title}")
    print(f"   URL: https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit")
    print(f"   ВАЖНО: Дайте доступ сервисному аккаунту к этой таблице!")
    
    return spreadsheet_id

# ======== МАППИНГ КОЛОНОК ПО ЗАГОЛОВКАМ ========
# Привязка полей к колонкам по ИМЕНАМ заголовков (порядок не важен).
# ВНИМАНИЕ: дубль этого словаря есть в bot_handler.py — держать синхронно.
COLUMN_SYNONYMS = {
    "id":          ["ID", "№"],
    "created":     ["Дата создания", "Data sozdaniya"],
    "author":      ["Автор/Источник", "Avtor/Istochnik", "Автор", "Источник"],
    "contragent":  ["Контрагент", "Компания", "КА"],
    "description": ["Описание", "Opisanie"],
    "assignee":    ["Ответственный", "Otvetstvenniy"],
    "deadline":    ["Срок", "Srok", "Srok korr", "Srok plan"],
    "status":      ["Статус", "Status"],
    "closed":      ["Дата закрытия", "Data zakrytiya"],
    "comment":     ["Комментарий", "Kommentariy"],
}
REQUIRED_FIELDS = ["id", "description", "assignee", "deadline", "status"]
FIELD_LABELS = {
    "id": "ID", "created": "Дата создания", "author": "Автор/Источник",
    "contragent": "Контрагент", "description": "Описание",
    "assignee": "Ответственный", "deadline": "Срок", "status": "Статус",
    "closed": "Дата закрытия", "comment": "Комментарий",
}


def get_col_map(worksheet) -> Dict[str, int]:
    """Карта «поле → индекс колонки (0-based)» по заголовкам первой строки.

    Срок: если есть обе колонки «Srok plan»/«Srok korr», то deadline = korr
    (куда пишем правки), а deadline_fallback = plan (откуда читаем, если korr
    пуст). Иначе deadline — единственная найденная колонка срока."""
    headers = [h.strip().lower() for h in worksheet.row_values(1)]
    col_map: Dict[str, int] = {}
    for field, names in COLUMN_SYNONYMS.items():
        for name in names:
            key = name.strip().lower()
            if key in headers:
                col_map[field] = headers.index(key)
                break
    if "srok plan" in headers and "srok korr" in headers:
        col_map["deadline"] = headers.index("srok korr")
        col_map["deadline_fallback"] = headers.index("srok plan")
    return col_map


def field_val(row, col_map: Dict[str, int], field: str) -> str:
    """Значение поля из строки по карте колонок. Для срока: korr, иначе plan."""
    idx = col_map.get(field)
    val = row[idx].strip() if idx is not None and len(row) > idx else ""
    if field == "deadline" and not val:
        alt = col_map.get("deadline_fallback")
        if alt is not None and len(row) > alt:
            val = row[alt].strip()
    return val


def check_required_fields(col_map: Dict[str, int]) -> Optional[str]:
    """Сообщение об ошибке, если обязательные колонки не найдены."""
    missing = [FIELD_LABELS[f] for f in REQUIRED_FIELDS if f not in col_map]
    if missing:
        return ("❌ В реестре не найдены обязательные колонки: "
                + ", ".join(missing)
                + ". Проверьте заголовки первой строки.")
    return None


def deadline_write_col(col_map: Dict[str, int], for_update: bool) -> Optional[int]:
    """Колонка (1-based) для записи срока: правка → korr, создание → plan."""
    if for_update:
        idx = col_map.get("deadline")
    else:
        idx = col_map.get("deadline_fallback", col_map.get("deadline"))
    return idx + 1 if idx is not None else None


def get_worksheet(client):
    """Получает лист с поручениями."""
    spreadsheet_id = get_active_registry()

    if not spreadsheet_id:
        print("❌ Таблица не настроена. Запустите: python task_manager.py --init")
        sys.exit(1)

    spreadsheet = client.open_by_key(spreadsheet_id)
    return spreadsheet.sheet1

def get_next_id(worksheet, col_map: Dict[str, int]) -> int:
    """Получает следующий ID поручения."""
    values = worksheet.get_all_values()
    if len(values) <= 1:
        return 1

    id_idx = col_map.get("id", 0)
    ids = []
    for row in values[1:]:
        if len(row) > id_idx and row[id_idx].strip().isdigit():
            ids.append(int(row[id_idx].strip()))

    return max(ids) + 1 if ids else 1

def add_task(args):
    """Добавляет новое поручение."""
    client = get_gsheets_client()
    worksheet = get_worksheet(client)
    col_map = get_col_map(worksheet)
    err = check_required_fields(col_map)
    if err:
        print(err)
        return

    task_id = get_next_id(worksheet, col_map)
    today = datetime.now(MSK).strftime("%d.%m.%Y")

    ncols = max(len(worksheet.row_values(1)), max(col_map.values()) + 1)
    row = [""] * ncols

    def put(field, value):
        idx = col_map.get(field)
        if idx is not None:
            row[idx] = value

    put("id", str(task_id))
    put("created", today)
    put("author", args.author)
    put("contragent", args.contragent)
    put("description", args.description)
    put("assignee", args.assignee)
    # Срок при создании — в плановую колонку (Srok plan, если есть)
    dl_idx = col_map.get("deadline_fallback", col_map.get("deadline"))
    if dl_idx is not None:
        row[dl_idx] = args.deadline
    put("status", args.status or "Новое")
    put("closed", "")
    put("comment", args.comment or "")

    worksheet.append_row(row)

    print(f"Поручение #{task_id} добавлено")
    print(f"   Контрагент: {args.contragent}")
    print(f"   Ответственный: {args.assignee}")
    print(f"   Срок: {args.deadline}")
    print(f"   Статус: {args.status or 'Новое'}")

def list_tasks(args):
    """Выводит список поручений."""
    client = get_gsheets_client()
    worksheet = get_worksheet(client)
    col_map = get_col_map(worksheet)
    err = check_required_fields(col_map)
    if err:
        print(err)
        return

    values = worksheet.get_all_values()

    if len(values) <= 1:
        print("📭 Реестр пуст")
        return

    rows = values[1:]

    # Фильтрация
    filtered = rows

    if args.status:
        statuses = [s.strip() for s in args.status.split(',')]
        filtered = [r for r in filtered if field_val(r, col_map, "status") in statuses]

    if args.contragent:
        filtered = [r for r in filtered
                    if args.contragent.lower() in field_val(r, col_map, "contragent").lower()]

    if args.assignee:
        filtered = [r for r in filtered
                    if args.assignee.lower() in field_val(r, col_map, "assignee").lower()]

    if not filtered:
        print("Поручения не найдены")
        return

    # Полный машиночитаемый вывод без обрезки (для бота)
    if getattr(args, 'json', False):
        data = [{
            "id": field_val(r, col_map, "id"),
            "created": field_val(r, col_map, "created"),
            "author": field_val(r, col_map, "author"),
            "contragent": field_val(r, col_map, "contragent"),
            "description": field_val(r, col_map, "description"),
            "assignee": field_val(r, col_map, "assignee"),
            "deadline": field_val(r, col_map, "deadline"),
            "status": field_val(r, col_map, "status"),
            "closed": field_val(r, col_map, "closed"),
            "comment": field_val(r, col_map, "comment"),
        } for r in filtered]
        print(json.dumps(data, ensure_ascii=False))
        return

    print(f"\nНайдено поручений: {len(filtered)}\n")
    print(f"{'ID':<5} {'Статус':<12} {'Срок':<12} {'Контрагент':<20} {'Ответственный':<20} {'Описание'}")
    print("-" * 100)

    for row in filtered:
        task_id = field_val(row, col_map, "id") or "?"
        status = field_val(row, col_map, "status") or "?"
        deadline = field_val(row, col_map, "deadline") or "?"
        contragent = field_val(row, col_map, "contragent") or "?"
        assignee = field_val(row, col_map, "assignee") or "?"
        desc = field_val(row, col_map, "description") or "?"

        # Обрезаем длинные строки
        contragent = (contragent[:17] + '...') if len(contragent) > 20 else contragent
        assignee = (assignee[:17] + '...') if len(assignee) > 20 else assignee
        desc = (desc[:37] + '...') if len(desc) > 40 else desc

        print(f"{task_id:<5} {status:<12} {deadline:<12} {contragent:<20} {assignee:<20} {desc}")

def update_task(args):
    """Обновляет поручение."""
    client = get_gsheets_client()
    worksheet = get_worksheet(client)
    col_map = get_col_map(worksheet)
    err = check_required_fields(col_map)
    if err:
        print(err)
        return

    values = worksheet.get_all_values()

    row_idx = None
    for i, row in enumerate(values[1:], start=2):
        if field_val(row, col_map, "id") == str(args.id):
            row_idx = i
            break

    if not row_idx:
        print(f"❌ Поручение #{args.id} не найдено")
        return

    def write(field, value, for_update=True):
        if field == "deadline":
            col = deadline_write_col(col_map, for_update)
        else:
            idx = col_map.get(field)
            col = idx + 1 if idx is not None else None
        if col:
            worksheet.update_cell(row_idx, col, value)
            return True
        return False

    updates = []

    if args.status:
        if write("status", args.status):
            updates.append(f"Статус → {args.status}")

        # Если статус "Выполнено" или "Отменено", ставим дату закрытия
        if args.status in ["Выполнено", "Отменено"]:
            today = datetime.now(MSK).strftime("%d.%m.%Y")
            if write("closed", today):
                updates.append(f"Дата закрытия → {today}")

    if args.comment:
        if write("comment", args.comment):
            updates.append(f"Комментарий обновлён")

    if args.deadline:
        # Правка срока — в колонку корректировки (Srok korr, если есть)
        if write("deadline", args.deadline, for_update=True):
            updates.append(f"Срок → {args.deadline}")

    if args.assignee:
        if write("assignee", args.assignee):
            updates.append(f"Ответственный → {args.assignee}")

    if args.description:
        if write("description", args.description):
            updates.append(f"Описание обновлено")

    if updates:
        print(f"✅ Поручение #{args.id} обновлено:")
        for u in updates:
            print(f"   • {u}")
    else:
        print("ℹ️  Нечего обновлять")

def delete_task(args):
    """Удаляет поручение."""
    client = get_gsheets_client()
    worksheet = get_worksheet(client)
    col_map = get_col_map(worksheet)

    values = worksheet.get_all_values()

    row_idx = None
    for i, row in enumerate(values[1:], start=2):
        if field_val(row, col_map, "id") == str(args.id):
            row_idx = i
            break
    
    if not row_idx:
        print(f"Поручение #{args.id} не найдено")
        return
    
    worksheet.delete_rows(row_idx)
    print(f"Поручение #{args.id} удалено")

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


def format_assignee(name: str, mapping: Dict[str, str]) -> str:
    """Форматирует имя ответственного, подставляя Telegram username если есть."""
    if not name:
        return "?"
    # Проверяем точное совпадение
    if name in mapping:
        return mapping[name]
    # Проверяем частичные совпадения (если в имени есть фамилия)
    for key, username in mapping.items():
        if key in name:
            return username
    return html.escape(name)


def generate_digest_advice(selected, today, col_map, no_deadline=None) -> Optional[str]:
    """Короткое наблюдение/совет по дайджесту через Kimi API.
    При любой ошибке возвращает None — дайджест уходит без совета."""
    kimi_config = os.path.join(CREDS_DIR, 'kimi.json')
    if not os.path.exists(kimi_config):
        return None
    try:
        with open(kimi_config, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        if not cfg.get('api_key'):
            return None
        import requests
    except Exception:
        return None

    task_lines = []
    for d, row in selected:
        days_over = (today.date() - d).days
        task_lines.append(
            f"#{field_val(row, col_map, 'id')}; "
            f"контрагент={field_val(row, col_map, 'contragent')}; "
            f"ответственный={field_val(row, col_map, 'assignee')}; "
            f"срок={d.strftime('%d.%m.%Y')}; "
            f"статус={field_val(row, col_map, 'status')}; "
            f"просрочка_дней={days_over}; "
            f"описание={field_val(row, col_map, 'description')[:80]}"
        )
    for row in (no_deadline or []):
        task_lines.append(
            f"#{field_val(row, col_map, 'id')}; "
            f"контрагент={field_val(row, col_map, 'contragent')}; "
            f"ответственный={field_val(row, col_map, 'assignee')}; "
            f"срок=НЕ ЗАДАН; статус={field_val(row, col_map, 'status')}; "
            f"описание={field_val(row, col_map, 'description')[:80]}"
        )
    prompt = (
        "Ты — PMO-ассистент. Ниже открытые поручения из утреннего дайджеста "
        f"(сегодня {today.strftime('%d.%m.%Y')}):\n" + "\n".join(task_lines) +
        "\n\nДай ОДНО короткое наблюдение или совет для руководителя "
        "(1-2 предложения, до 250 символов): концентрация просрочек на человеке "
        "или контрагенте, перегруз исполнителя, ближайшие дедлайны, поручения "
        "без срока. Пиши по-русски, "
        "конкретно, опираясь на цифры из списка. Начни с подходящего эмодзи "
        "(⚠️ если есть проблема, 💡 если совет, ✅ если всё под контролем). "
        "Верни только текст наблюдения, без заголовков и пояснений."
    )
    payload = {
        "model": cfg.get('model', 'moonshot-v1-8k'),
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 200,
    }
    try:
        base_url = cfg.get('base_url', 'https://api.moonshot.ai/v1').rstrip('/')
        resp = requests.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {cfg['api_key']}",
                     "Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
        if resp.status_code != 200:
            print(f"⚠️ Kimi API вернул {resp.status_code}, дайджест без совета",
                  file=sys.stderr)
            return None
        advice = (resp.json().get('choices') or [{}])[0] \
                         .get('message', {}).get('content', '').strip()
        advice = advice.strip().strip('*"«»').strip()
        return advice or None
    except Exception as e:
        print(f"⚠️ Ошибка LLM-совета: {e}", file=sys.stderr)
        return None


def check_deadlines(args):
    """Дайджест: все открытые поручения со сроком не позднее 14 дней
    от текущей даты, отсортированные по сроку (ранние выше)."""
    client = get_gsheets_client()
    worksheet = get_worksheet(client)
    col_map = get_col_map(worksheet)
    err = check_required_fields(col_map)
    if err:
        print(err)
        return

    values = worksheet.get_all_values()

    if len(values) <= 1:
        print("Реестр пуст")
        return

    today = datetime.now(MSK)
    horizon = (today + timedelta(days=14)).date()

    selected = []
    no_deadline = []

    for i, row in enumerate(values[1:], start=2):
        status = field_val(row, col_map, "status")
        if status in ["Выполнено", "Отменено"]:
            continue

        deadline_str = field_val(row, col_map, "deadline")
        try:
            deadline = datetime.strptime(deadline_str, "%d.%m.%Y")
        except (ValueError, IndexError):
            # Открытое поручение без срока — отдельный блок дайджеста.
            # Пустые строки (только ID, без описания и ответственного) пропускаем.
            if (field_val(row, col_map, "id")
                    and (field_val(row, col_map, "description")
                         or field_val(row, col_map, "assignee"))):
                no_deadline.append(row)
            continue

        if deadline.date() > horizon:
            continue

        # Помечаем просроченные в реестре (только если статус ещё не проставлен)
        if deadline.date() < today.date() and status != "Просрочено":
            status_col = col_map.get("status")
            if status_col is not None:
                try:
                    worksheet.update_cell(i, status_col + 1, "Просрочено")
                except Exception as e:
                    # Нет прав на запись — дайджест всё равно должен уйти
                    print(f"⚠️ Не удалось пометить просрочку (строка {i}): {e}",
                          file=sys.stderr)
        selected.append((deadline.date(), row))

    if not selected and not no_deadline:
        print(f"Открытых поручений со сроком до {horizon.strftime('%d.%m.%Y')} нет")
        return

    user_mapping = load_user_mapping()

    # Сортировка по дате: самые ранние выше, самые поздние ниже
    selected.sort(key=lambda x: x[0])

    lines = [f"<b>🤖 ДАЙДЖЕСТ ПОРУЧЕНИЙ — {today.strftime('%d.%m.%Y')}</b>",
             f"Открытые со сроком до {horizon.strftime('%d.%m.%Y')}: "
             f"<b>{len(selected)}</b>\n"]
    for d, row in selected:
        desc = html.escape(field_val(row, col_map, "description"))
        if len(desc) > 100:
            desc = desc[:97] + "..."
        assignee = format_assignee(field_val(row, col_map, "assignee"),
                                   user_mapping)
        days_over = (today.date() - d).days
        if days_over > 0:
            suffix = f"просрочено на {days_over} дн."
        elif days_over == 0:
            suffix = "сегодня"
        elif days_over == -1:
            suffix = "завтра"
        else:
            suffix = f"через {-days_over} дн."
        lines.append(f"  <b>#{field_val(row, col_map, 'id')}:</b> {assignee} — {desc}\n"
                     f"   📅 <b>{d.strftime('%d.%m.%Y')}</b> ({suffix})")

    if no_deadline:
        lines.append(f"\n⚠️ <b>Без срока: {len(no_deadline)} шт.</b>")
        for row in no_deadline:
            desc = html.escape(field_val(row, col_map, "description"))
            if len(desc) > 100:
                desc = desc[:97] + "..."
            assignee_nd = format_assignee(field_val(row, col_map, "assignee"),
                                          user_mapping)
            lines.append(f"  <b>#{field_val(row, col_map, 'id')}:</b> "
                         f"{assignee_nd} — {desc}")

    full_message = "\n".join(lines)

    # LLM-наблюдение — только для плановой рассылки (флаг --advice)
    if getattr(args, 'advice', False):
        advice = generate_digest_advice(selected, today, col_map, no_deadline)
        if advice:
            full_message += f"\n\n{html.escape(advice)}"

    # Добавляем ссылку на исходник
    spreadsheet_id = get_active_registry()
    if spreadsheet_id:
        full_message += f"\n\n📋 https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"

    print(full_message)

    # Отправляем в Telegram
    send_telegram(full_message)

def send_telegram(message: str):
    """Отправляет сообщение в Telegram, разбивая на части при необходимости."""
    telegram_config = os.path.join(CREDS_DIR, 'telegram.json')
    
    if not os.path.exists(telegram_config):
        print("\n⚠️  Telegram не настроен. Пропускаю отправку.")
        return
    
    try:
        import requests
        
        with open(telegram_config, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        url = f"https://api.telegram.org/bot{config['bot_token']}/sendMessage"
        
        # Разбиваем сообщение на части (лимит Telegram ~4096, берём 3800 с запасом)
        MAX_LEN = 3800
        parts = _split_message(message, MAX_LEN)
        
        for i, part in enumerate(parts):
            payload = {
                'chat_id': config['chat_id'],
                'text': part,
                'parse_mode': 'HTML',
                'disable_web_page_preview': True
            }
            
            response = requests.post(url, json=payload, timeout=30)
            
            if response.status_code == 200:
                print(f"\nУведомление часть {i+1}/{len(parts)} отправлено в Telegram")
            else:
                print(f"\nОшибка отправки части {i+1} в Telegram: {response.status_code}")
                print(f"Ответ: {response.text[:200]}")
            
    except ImportError:
        print("\nУстановите requests: pip install requests")
    except Exception as e:
        print(f"\nОшибка Telegram: {e}")


def _split_message(message: str, max_len: int = 3800) -> list:
    """Разбивает сообщение на части, стараясь не резать посередине блока."""
    if len(message) <= max_len:
        return [message]
    
    parts = []
    # Разбиваем по блокам (двойной перенос строки — разделитель секций)
    blocks = message.split('\n\n')
    
    current = ""
    for block in blocks:
        # Если блок сам по себе длиннее лимита — разбиваем по строкам
        if len(block) > max_len:
            if current:
                parts.append(current.strip())
                current = ""
            lines = block.split('\n')
            current_line_block = ""
            for line in lines:
                if len(current_line_block) + len(line) + 1 > max_len:
                    parts.append(current_line_block.strip())
                    current_line_block = line
                else:
                    current_line_block += '\n' + line if current_line_block else line
            if current_line_block:
                current = current_line_block
            continue
        
        # Проверяем, влезет ли блок в текущую часть
        if len(current) + len(block) + 2 > max_len:
            if current:
                parts.append(current.strip())
            current = block
        else:
            current += '\n\n' + block if current else block
    
    if current:
        parts.append(current.strip())
    
    return parts if parts else [message]

def init_registry(args):
    """Инициализирует реестр поручений."""
    client = get_gsheets_client()
    spreadsheet_id = get_or_create_spreadsheet(client)
    
    print(f"\n✅ Реестр поручений готов к работе!")
    print(f"   Не забудьте открыть таблицу и дать доступ сервисному аккаунту")

def main():
    parser = argparse.ArgumentParser(description='Управление реестром поручений')
    subparsers = parser.add_subparsers(dest='command')
    
    # init
    init_parser = subparsers.add_parser('init', help='Инициализировать реестр')
    
    # add
    add_parser = subparsers.add_parser('add', help='Добавить поручение')
    add_parser.add_argument('--author', required=True, help='Автор/источник')
    add_parser.add_argument('--contragent', required=True, help='Контрагент')
    add_parser.add_argument('--description', required=True, help='Описание')
    add_parser.add_argument('--assignee', required=True, help='Ответственный')
    add_parser.add_argument('--deadline', required=True, help='Срок (ДД.ММ.ГГГГ)')
    add_parser.add_argument('--status', default='Новое', help='Статус (по умолчанию: Новое)')
    add_parser.add_argument('--comment', help='Комментарий')
    
    # list
    list_parser = subparsers.add_parser('list', help='Список поручений')
    list_parser.add_argument('--status', help='Фильтр по статусу (через запятую)')
    list_parser.add_argument('--contragent', help='Фильтр по контрагенту')
    list_parser.add_argument('--assignee', help='Фильтр по ответственному')
    list_parser.add_argument('--json', action='store_true',
                             help='Полный JSON-вывод без обрезки (для бота)')
    
    # update
    update_parser = subparsers.add_parser('update', help='Обновить поручение')
    update_parser.add_argument('id', type=int, help='ID поручения')
    update_parser.add_argument('--status', help='Новый статус')
    update_parser.add_argument('--deadline', help='Новый срок')
    update_parser.add_argument('--comment', help='Комментарий')
    update_parser.add_argument('--assignee', help='Новый ответственный')
    update_parser.add_argument('--description', help='Новое описание')
    
    # check-deadlines
    check_parser = subparsers.add_parser('check-deadlines', help='Проверить сроки')
    check_parser.add_argument('--advice', action='store_true',
                              help='Добавить LLM-наблюдение (для плановой рассылки)')
    
    # delete
    delete_parser = subparsers.add_parser('delete', help='Удалить поручение')
    delete_parser.add_argument('id', type=int, help='ID поручения')
    
    args = parser.parse_args()
    
    if args.command == 'init':
        init_registry(args)
    elif args.command == 'add':
        add_task(args)
    elif args.command == 'list':
        list_tasks(args)
    elif args.command == 'update':
        update_task(args)
    elif args.command == 'check-deadlines':
        check_deadlines(args)
    elif args.command == 'delete':
        delete_task(args)
    else:
        parser.print_help()

if __name__ == '__main__':
    main()
