#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""История присланных планов по чатам (BL-1).

Храним ТОЛЬКО метаданные (file_id, имя файла, дата) — сами файлы остаются
в истории Telegram и при необходимости пересскачиваются через getFile.
Файлы плана на сервере не сохраняются (stateless по контенту).
"""

import json
import os
from datetime import datetime
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(SCRIPT_DIR, 'state.json')
MAX_PER_CHAT = 5


def _load() -> dict:
    if not os.path.exists(STATE_PATH):
        return {}
    try:
        with open(STATE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _save(state: dict) -> None:
    with open(STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def remember_plan(chat_id: int, file_id: str, file_name: str) -> None:
    state = _load()
    items = state.setdefault(str(chat_id), [])
    items.append({'file_id': file_id, 'file_name': file_name,
                  'ts': datetime.now().isoformat(timespec='seconds')})
    state[str(chat_id)] = items[-MAX_PER_CHAT:]
    _save(state)


def last_plan(chat_id: int) -> Optional[dict]:
    items = _load().get(str(chat_id), [])
    return items[-1] if items else None


def previous_plan(chat_id: int) -> Optional[dict]:
    """Предпоследний присланный план — база для диффа."""
    items = _load().get(str(chat_id), [])
    return items[-2] if len(items) >= 2 else None


# ---------- Кэш последнего аудита (drill-down, спонсорский отчёт) ----------
# Факты анализа (метаданные, не файл плана) сохраняются на диск — кнопки
# детализации и «Отчёт для спонсора» работают и после перезапуска бота
# (решение 13.09.26: «сессия не должна устаревать»).

LASTRUN_PATH = os.path.join(SCRIPT_DIR, 'last_run.json')


def save_last_run(chat_id: int, plan_name: str, facts: dict) -> None:
    try:
        data = {}
        if os.path.exists(LASTRUN_PATH):
            with open(LASTRUN_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
        data[str(chat_id)] = {
            'plan_name': plan_name, 'facts': facts,
            'ts': datetime.now().isoformat(timespec='seconds')}
        with open(LASTRUN_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, default=str)
    except Exception as e:
        print(f'⚠️ не удалось сохранить last_run: {e}')


def load_last_run(chat_id: int) -> Optional[dict]:
    try:
        with open(LASTRUN_PATH, 'r', encoding='utf-8') as f:
            return json.load(f).get(str(chat_id))
    except Exception:
        return None


# ---------- История аудитов (v1.2): тренд для спонсорского дайджеста ----------
# Каждый прогон аудита дописывает компактный снимок фактов (без списков
# задач) в JSONL. Тренд считается между последними двумя снимками чата.
# Файлы планов по-прежнему не храним — только метрики.

HISTORY_PATH = os.path.join(SCRIPT_DIR, 'audit_history.jsonl')
MAX_HISTORY = 26  # ~полгода при еженедельных аудитах


def snapshot_run(chat_id: int, facts: dict) -> dict:
    """Снимок ключевых метрик прогона. Возвращает снимок (и пишет в историю)."""
    m = facts.get('metrics') or {}
    evm = facts.get('evm') or {}
    sched = facts.get('schedule_health') or {}
    health = facts.get('health') or {}
    snap = {
        'chat_id': str(chat_id),
        'ts': datetime.now().isoformat(timespec='seconds'),
        'report_date': facts.get('report_date'),
        'health_status': health.get('status'),
        'health_label': health.get('label'),
        'spi': evm.get('spi'),
        'bei': sched.get('bei'),
        'overdue': m.get('overdue'),
        'tasks_total': m.get('tasks_total'),
        'done_pct': round(100.0 * m.get('done', 0) / max(1, m.get('tasks_total', 1))),
        'compliance_score': facts.get('compliance_score'),
    }
    try:
        lines = []
        if os.path.exists(HISTORY_PATH):
            with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
                lines = [ln for ln in f.read().splitlines() if ln.strip()]
        lines.append(json.dumps(snap, ensure_ascii=False))
        # ротация: держим последние MAX_HISTORY снимков этого чата
        mine, other = [], []
        for ln in lines:
            try:
                (mine if json.loads(ln).get('chat_id') == str(chat_id)
                 else other).append(ln)
            except Exception:
                other.append(ln)
        mine = mine[-MAX_HISTORY:]
        with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
            f.write('\n'.join(other + mine) + '\n')
    except Exception as e:
        print(f'⚠️ не удалось записать audit_history: {e}', flush=True)
    return snap


def load_history(chat_id: int) -> list:
    """Снимки чата от старых к новым (для расчёта тренда)."""
    if not os.path.exists(HISTORY_PATH):
        return []
    out = []
    try:
        with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
            for ln in f.read().splitlines():
                if not ln.strip():
                    continue
                try:
                    rec = json.loads(ln)
                except Exception:
                    continue
                if rec.get('chat_id') == str(chat_id):
                    out.append(rec)
    except Exception:
        return []
    return out
