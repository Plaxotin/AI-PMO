#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BL-36: запись подтверждённых предложений в Google Sheets (файл BL-6).

SPEC-BL-36 v0.3 (§2 решение 4, §6.4): все реестры — в Google Sheets:
- поручение → основной реестр (первая вкладка, колонки по COLUMN_SYNONYMS,
  паттерн task_manager BL-6: ID числом, дата МСК, статус «В работе»);
- решение → вкладка «Решения» (создаётся при первой записи);
- риск → вкладка «Риски» (создаётся при первой записи).

Конфиги (.credentials/, не в репо):
  gsheets-service-account.json — сервисный аккаунт (как у BL-6)
  config.json — spreadsheet_id (активный реестр BL-6)
"""

import datetime as dt

import gspread
from google.oauth2.service_account import Credentials

import config

MSK = dt.timezone(dt.timedelta(hours=3))

COLUMN_SYNONYMS = {
    "id":          ["ID", "№"],
    "created":     ["Дата создания", "Data sozdaniya"],
    "author":      ["Автор/Источник", "Avtor/Istochnik", "Автор", "Источник"],
    "contragent":  ["Контрагент", "Компания", "КА"],
    "description": ["Описание", "Opisanie"],
    "assignee":    ["Ответственный", "Otvetstvenniy"],
    "deadline":    ["Срок", "Srok", "Srok korr", "Srok plan"],
    "status":      ["Статус", "Status"],
    "comment":     ["Комментарий", "Kommentariy"],
    "priority":    ["Приоритет", "Prioritet"],
}

DECISION_HEADERS = ["ID", "Дата", "Решение", "Источник", "Принял"]
RISK_HEADERS = ["ID", "Дата", "Риск", "Статус", "Источник", "Принял"]

_client = None


def _get_client():
    global _client
    if _client is None:
        import os
        creds_file = os.path.join(config.CREDS_DIR, 'gsheets-service-account.json')
        creds = Credentials.from_service_account_file(
            creds_file,
            scopes=['https://www.googleapis.com/auth/spreadsheets'])
        _client = gspread.authorize(creds)
    return _client


def _spreadsheet():
    sid = config.load_config().get('spreadsheet_id')
    if not sid:
        raise RuntimeError('config.json: нет spreadsheet_id')
    return _get_client().open_by_key(sid)


def _col_map(worksheet):
    headers = [h.strip().lower() for h in worksheet.row_values(1)]
    col_map = {}
    for field, names in COLUMN_SYNONYMS.items():
        for name in names:
            key = name.strip().lower()
            if key in headers:
                col_map[field] = headers.index(key)
                break
    if "srok plan" in headers and "srok korr" in headers:
        col_map["deadline_fallback"] = headers.index("srok plan")
    return col_map


def _next_num_id(worksheet, id_col=0):
    values = worksheet.get_all_values()
    ids = []
    for row in values[1:]:
        if len(row) > id_col and row[id_col].strip().isdigit():
            ids.append(int(row[id_col].strip()))
    return max(ids) + 1 if ids else 1


def _get_or_create_tab(spreadsheet, title, headers):
    try:
        return spreadsheet.worksheet(title)
    except gspread.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=title, rows=200,
                                       cols=len(headers))
        ws.append_row(headers, value_input_option='USER_ENTERED')
        return ws


def add_assignment(p, decided_by_name):
    """Поручение в основной реестр BL-6. Возвращает описание записи."""
    ws = _spreadsheet().sheet1
    col_map = _col_map(ws)
    task_id = _next_num_id(ws, col_map.get('id', 0))
    today = dt.datetime.now(MSK).strftime('%d.%m.%Y')
    ncols = max(len(ws.row_values(1)), max(col_map.values()) + 1)
    row = [''] * ncols

    def put(field, value):
        idx = col_map.get(field)
        if idx is not None and value not in (None, ''):
            row[idx] = str(value)

    put('id', task_id)
    put('created', today)
    put('author', 'PMO Vision (TG-надзор)')
    put('description', p.get('text'))
    put('assignee', p.get('assignee') or '')
    dl_idx = col_map.get('deadline_fallback', col_map.get('deadline'))
    if dl_idx is not None and p.get('due'):
        row[dl_idx] = str(p['due'])
    put('status', 'В работе')
    links = [l for l in (p.get('source_links') or []) if l]
    comment = 'Источник: %s' % links[0] if links else ''
    put('comment', comment)
    ws.append_row(row, value_input_option='USER_ENTERED')
    return 'Поручение #%s в реестре BL-6' % task_id


def add_decision(p, decided_by_name):
    ws = _get_or_create_tab(_spreadsheet(), 'Решения', DECISION_HEADERS)
    rec_id = _next_num_id(ws)
    today = dt.datetime.now(MSK).strftime('%d.%m.%Y')
    links = [l for l in (p.get('source_links') or []) if l]
    ws.append_row([rec_id, today, p.get('text') or '',
                   links[0] if links else '', decided_by_name or ''],
                  value_input_option='USER_ENTERED')
    return 'Решение #%s во вкладке «Решения»' % rec_id


def add_risk(p, decided_by_name):
    ws = _get_or_create_tab(_spreadsheet(), 'Риски', RISK_HEADERS)
    rec_id = _next_num_id(ws)
    today = dt.datetime.now(MSK).strftime('%d.%m.%Y')
    links = [l for l in (p.get('source_links') or []) if l]
    ws.append_row([rec_id, today, p.get('text') or '', 'Открыт',
                   links[0] if links else '', decided_by_name or ''],
                  value_input_option='USER_ENTERED')
    return 'Риск #%s во вкладке «Риски»' % rec_id


WRITERS = {'assignment': add_assignment, 'decision': add_decision,
           'risk': add_risk}


def write_to_registry(proposal, decided_by_name=None):
    """Подтверждённое предложение → реестр. Возвращает текст результата."""
    writer = WRITERS.get(proposal['target'])
    if not writer:
        raise ValueError('unknown target: %s' % proposal['target'])
    return writer(proposal.get('payload') or {}, decided_by_name)
