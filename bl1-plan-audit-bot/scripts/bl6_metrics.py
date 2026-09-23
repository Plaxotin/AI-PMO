#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Read-only метрики реестра поручений BL-6 для спонсорского дайджеста (v1.2).

Источник — активный реестр BL-6 (Google Sheets, проект МТИ&PSI). Бот BL-1
ничего не пишет в реестр, только читает.

Подключение задаётся файлом .credentials/bl6_registry.json:
    {"spreadsheet_id": "<id таблицы>",
     "creds_path": "<путь к gsheets-service-account.json BL-6>"}
Если файла нет — метрика пропускается (дайджест собирается без блока
поручений). Пути/ids не хранятся в репозитории.
"""

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CREDS_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), '.credentials')
CONFIG_PATH = os.path.join(CREDS_DIR, 'bl6_registry.json')

MSK = timezone(timedelta(hours=3))

# Синонимы заголовков (подмножество COLUMN_SYNONYMS из BL-6 task_manager.py).
# Срок: «Srok korr» приоритетнее «Srok plan» — как в BL-6.
COLUMN_SYNONYMS = {
    'status':   ['Статус', 'Status'],
    'deadline': ['Срок', 'Srok', 'Srok korr', 'Srok plan'],
    'closed':   ['Дата закрытия', 'Data zakrytiya'],
}
CLOSED_STATUSES = ('Выполнено', 'Отменено')
DONE_STATUS = 'Выполнено'

_DATE_FORMATS = ('%d.%m.%Y', '%d.%m.%Y %H:%M', '%Y-%m-%d', '%Y-%m-%d %H:%M:%S')


def _parse_date(s: str) -> Optional[datetime]:
    s = (s or '').strip()
    if not s:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _load_config() -> Optional[dict]:
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        if cfg.get('spreadsheet_id'):
            return cfg
    except Exception as e:
        print(f'⚠️ bl6_registry.json не читается ({e}) — метрика BL-6 пропущена',
              flush=True)
    return None


def _get_col_map(headers) -> dict:
    headers = [h.strip().lower() for h in headers]
    col_map = {}
    for field, names in COLUMN_SYNONYMS.items():
        for name in names:
            key = name.strip().lower()
            if key in headers:
                col_map[field] = headers.index(key)
                break
    if 'srok plan' in headers and 'srok korr' in headers:
        col_map['deadline'] = headers.index('srok korr')
        col_map['deadline_fallback'] = headers.index('srok plan')
    return col_map


def _val(row, col_map, field) -> str:
    idx = col_map.get(field)
    val = row[idx].strip() if idx is not None and len(row) > idx else ''
    if field == 'deadline' and not val:
        alt = col_map.get('deadline_fallback')
        if alt is not None and len(row) > alt:
            val = row[alt].strip()
    return val


def load_bl6_metrics() -> Optional[dict]:
    """Метрики реестра поручений или None (нет конфига/доступа/библиотек)."""
    cfg = _load_config()
    if not cfg:
        return None
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        print('⚠️ gspread/google-auth не установлены — метрика BL-6 пропущена',
              flush=True)
        return None
    try:
        creds_path = cfg.get('creds_path') or os.path.join(
            CREDS_DIR, 'gsheets-service-account.json')
        scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly']
        creds = Credentials.from_service_account_file(creds_path, scopes=scopes)
        client = gspread.authorize(creds)
        sheet = client.open_by_key(cfg['spreadsheet_id']).sheet1
        values = sheet.get_all_values()
        if len(values) < 2:
            return None
        col_map = _get_col_map(values[0])
        if 'status' not in col_map:
            print('⚠️ в реестре BL-6 не найдена колонка «Статус»', flush=True)
            return None

        today = datetime.now(MSK).replace(tzinfo=None)
        total = open_ = done = canceled = open_overdue = 0
        done_on_time = done_late = 0
        for row in values[1:]:
            status = _val(row, col_map, 'status')
            if not status:
                continue
            total += 1
            deadline = _parse_date(_val(row, col_map, 'deadline'))
            closed = _parse_date(_val(row, col_map, 'closed'))
            if status in CLOSED_STATUSES:
                if status == DONE_STATUS:
                    done += 1
                    if closed and deadline:
                        if closed <= deadline:
                            done_on_time += 1
                        else:
                            done_late += 1
                else:
                    canceled += 1
            else:
                open_ += 1
                if deadline and deadline < today:
                    open_overdue += 1
        pct = (round(100.0 * done_on_time / (done_on_time + done_late))
               if (done_on_time + done_late) else None)
        return {
            'available': True,
            'as_of': datetime.now(MSK).strftime('%d.%m.%Y'),
            'total': total, 'open': open_, 'done': done, 'canceled': canceled,
            'open_overdue': open_overdue,
            'done_on_time': done_on_time, 'done_late': done_late,
            'done_on_time_pct': pct,
        }
    except Exception as e:
        print(f'⚠️ метрики BL-6 недоступны: {e}', flush=True)
        return None
