#!/usr/bin/env python3
"""
Основной скрипт управления реестром поручений.
"""

import argparse
import html
import os
import sys
import json
from datetime import datetime, timedelta
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
        "ID", "Дата создания", "Автор/Источник", "Проект", 
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

def get_worksheet(client):
    """Получает лист с поручениями."""
    spreadsheet_id = get_active_registry()
    
    if not spreadsheet_id:
        print("❌ Таблица не настроена. Запустите: python task_manager.py --init")
        sys.exit(1)
    
    spreadsheet = client.open_by_key(spreadsheet_id)
    return spreadsheet.sheet1

def get_next_id(worksheet) -> int:
    """Получает следующий ID поручения."""
    values = worksheet.get_all_values()
    if len(values) <= 1:
        return 1
    
    ids = []
    for row in values[1:]:
        if row and row[0].isdigit():
            ids.append(int(row[0]))
    
    return max(ids) + 1 if ids else 1

def add_task(args):
    """Добавляет новое поручение."""
    client = get_gsheets_client()
    worksheet = get_worksheet(client)
    
    task_id = get_next_id(worksheet)
    today = datetime.now().strftime("%d.%m.%Y")
    
    row = [
        task_id,
        today,
        args.author,
        args.project,
        args.description,
        args.assignee,
        args.deadline,
        args.status or "Новое",
        "",
        args.comment or ""
    ]
    
    worksheet.append_row(row)
    
    print(f"Поручение #{task_id} добавлено")
    print(f"   Контрагент: {args.project}")
    print(f"   Ответственный: {args.assignee}")
    print(f"   Срок: {args.deadline}")
    print(f"   Статус: {row[7]}")

def list_tasks(args):
    """Выводит список поручений."""
    client = get_gsheets_client()
    worksheet = get_worksheet(client)
    
    values = worksheet.get_all_values()
    
    if len(values) <= 1:
        print("📭 Реестр пуст")
        return
    
    headers = values[0]
    rows = values[1:]
    
    # Фильтрация
    filtered = rows
    
    if args.status:
        statuses = [s.strip() for s in args.status.split(',')]
        filtered = [r for r in filtered if len(r) > 7 and r[7] in statuses]
    
    if args.project:
        filtered = [r for r in filtered if len(r) > 3 and args.project.lower() in r[3].lower()]
    
    if args.assignee:
        filtered = [r for r in filtered if len(r) > 5 and args.assignee.lower() in r[5].lower()]
    
    if not filtered:
        print("Поручения не найдены")
        return

    # Полный машиночитаемый вывод без обрезки (для бота)
    if getattr(args, 'json', False):
        def cell(row, i):
            return row[i] if len(row) > i else ""
        data = [{
            "id": cell(r, 0),
            "created": cell(r, 1),
            "author": cell(r, 2),
            "project": cell(r, 3),
            "description": cell(r, 4),
            "assignee": cell(r, 5),
            "deadline": cell(r, 6),
            "status": cell(r, 7),
            "closed": cell(r, 8),
            "comment": cell(r, 9),
        } for r in filtered]
        print(json.dumps(data, ensure_ascii=False))
        return

    print(f"\nНайдено поручений: {len(filtered)}\n")
    print(f"{'ID':<5} {'Статус':<12} {'Срок':<12} {'Контрагент':<20} {'Ответственный':<20} {'Описание'}")
    print("-" * 100)
    
    for row in filtered:
        task_id = row[0] if len(row) > 0 else "?"
        status = row[7] if len(row) > 7 else "?"
        deadline = row[6] if len(row) > 6 else "?"
        project = row[3] if len(row) > 3 else "?"
        assignee = row[5] if len(row) > 5 else "?"
        desc = row[4] if len(row) > 4 else "?"
        
        # Обрезаем длинные строки
        project = (project[:17] + '...') if len(project) > 20 else project
        assignee = (assignee[:17] + '...') if len(assignee) > 20 else assignee
        desc = (desc[:37] + '...') if len(desc) > 40 else desc
        
        print(f"{task_id:<5} {status:<12} {deadline:<12} {project:<20} {assignee:<20} {desc}")

def update_task(args):
    """Обновляет поручение."""
    client = get_gsheets_client()
    worksheet = get_worksheet(client)
    
    values = worksheet.get_all_values()
    
    row_idx = None
    for i, row in enumerate(values[1:], start=2):
        if row and row[0] == str(args.id):
            row_idx = i
            break
    
    if not row_idx:
        print(f"❌ Поручение #{args.id} не найдено")
        return
    
    updates = []
    
    if args.status:
        worksheet.update_cell(row_idx, 8, args.status)
        updates.append(f"Статус → {args.status}")
        
        # Если статус "Выполнено" или "Отменено", ставим дату закрытия
        if args.status in ["Выполнено", "Отменено"]:
            today = datetime.now().strftime("%d.%m.%Y")
            worksheet.update_cell(row_idx, 9, today)
            updates.append(f"Дата закрытия → {today}")
    
    if args.comment:
        worksheet.update_cell(row_idx, 10, args.comment)
        updates.append(f"Комментарий обновлён")
    
    if args.deadline:
        worksheet.update_cell(row_idx, 7, args.deadline)
        updates.append(f"Срок → {args.deadline}")

    if args.assignee:
        worksheet.update_cell(row_idx, 6, args.assignee)
        updates.append(f"Ответственный → {args.assignee}")

    if args.description:
        worksheet.update_cell(row_idx, 5, args.description)
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
    
    values = worksheet.get_all_values()
    
    row_idx = None
    for i, row in enumerate(values[1:], start=2):
        if row and row[0] == str(args.id):
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


def check_deadlines(args):
    """Проверяет сроки и отправляет уведомления."""
    client = get_gsheets_client()
    worksheet = get_worksheet(client)
    
    values = worksheet.get_all_values()
    
    if len(values) <= 1:
        print("Реестр пуст")
        return
    
    today = datetime.now()
    tomorrow = today + timedelta(days=1)
    
    overdue = []
    due_today = []
    due_tomorrow = []
    
    for i, row in enumerate(values[1:], start=2):
        if len(row) < 8:
            continue
        
        status = row[7]
        if status in ["Выполнено", "Отменено"]:
            continue
        
        try:
            deadline = datetime.strptime(row[6], "%d.%m.%Y")
        except (ValueError, IndexError):
            continue
        
        # Проверяем просрочку
        if deadline.date() < today.date():
            worksheet.update_cell(i, 8, "Просрочено")
            overdue.append(row)
        elif deadline.date() == today.date():
            due_today.append(row)
        elif deadline.date() == tomorrow.date():
            due_tomorrow.append(row)
    
    user_mapping = load_user_mapping()
    
    # Формируем сообщение
    messages = []
    
    if overdue:
        messages.append(f"<b>⚠️ ПРОСРОЧЕНО: {len(overdue)} поручений</b>")
        for row in overdue:
            desc = html.escape(row[4][:50])
            assignee = format_assignee(row[5], user_mapping)
            deadline = html.escape(row[6])
            messages.append(f"  #{row[0]}: {desc} (ответственный: {assignee}) — 📅 <b>{deadline}</b>")
    
    if due_today:
        messages.append(f"\n<b>🔴 СРОК СЕГОДНЯ: {len(due_today)} поручений</b>")
        for row in due_today:
            desc = html.escape(row[4][:50])
            assignee = format_assignee(row[5], user_mapping)
            deadline = html.escape(row[6])
            messages.append(f"  #{row[0]}: {desc} (ответственный: {assignee}) — 📅 <b>{deadline}</b>")
    
    if due_tomorrow:
        messages.append(f"\n<b>📅 СРОК ЗАВТРА: {len(due_tomorrow)} поручений</b>")
        for row in due_tomorrow:
            desc = html.escape(row[4][:50])
            assignee = format_assignee(row[5], user_mapping)
            deadline = html.escape(row[6])
            messages.append(f"  #{row[0]}: {desc} (ответственный: {assignee}) — 📅 <b>{deadline}</b>")
    
    if not messages:
        print("Все поручения в норме, срочных нет")
        return
    
    full_message = "<b>🤖 ПРОВЕРКА ПОРУЧЕНИЙ</b>\n\n" + "\n".join(messages)
    
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
    add_parser.add_argument('--project', required=True, help='Проект')
    add_parser.add_argument('--description', required=True, help='Описание')
    add_parser.add_argument('--assignee', required=True, help='Ответственный')
    add_parser.add_argument('--deadline', required=True, help='Срок (ДД.ММ.ГГГГ)')
    add_parser.add_argument('--status', default='Новое', help='Статус (по умолчанию: Новое)')
    add_parser.add_argument('--comment', help='Комментарий')
    
    # list
    list_parser = subparsers.add_parser('list', help='Список поручений')
    list_parser.add_argument('--status', help='Фильтр по статусу (через запятую)')
    list_parser.add_argument('--project', help='Фильтр по проекту')
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
