#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Статистика использования и бесплатные месячные лимиты (24.09.26).

Бот открыт для всех в Telegram: у каждого пользователя, КРОМЕ владельца,
в календарном месяце (по Москве) — 1 попытка аудита и 1 попытка спонсорского
отчёта бесплатно. Дайджест и конвертация .mpp лимитам не подлежат.

Попытка считается при старте прогона. Если прогон упал с ошибкой сервиса —
попытка возвращается (refund), чтобы сбой бота не сжигал квоту пользователя.

Файл: usage.json рядом со state.json (не в репо, на сервере).
"""

import json
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
USAGE_PATH = os.path.join(SCRIPT_DIR, 'usage.json')

MSK = timezone(timedelta(hours=3))  # месяц считаем по московскому времени

# Бесплатные лимиты на человека в месяц (владельцу не применяются)
LIMITS = {'audit': 1, 'sponsor': 1}

OWNER_IDS = (107227641,)  # @plaxo Константин

_lock = threading.Lock()


def _month(now: Optional[datetime] = None) -> str:
    return (now or datetime.now(MSK)).strftime('%Y-%m')


def _load() -> dict:
    if not os.path.exists(USAGE_PATH):
        return {}
    try:
        with open(USAGE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _save(data: dict) -> None:
    tmp = USAGE_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, USAGE_PATH)


def _owners() -> set:
    ids = list(OWNER_IDS)
    try:
        from config import load_telegram_config
        cfg = load_telegram_config() or {}
        ids += [int(i) for i in (cfg.get('admin_ids') or [])]
    except Exception:
        pass
    return set(ids)


def is_owner(chat_id) -> bool:
    try:
        return int(chat_id) in _owners()
    except Exception:
        return False


def record(chat_id, kind: str) -> None:
    """Засчитать попытку (вызывается в начале прогона)."""
    if kind not in LIMITS:
        return
    with _lock:
        data = _load()
        m = data.setdefault(_month(), {})
        u = m.setdefault(str(chat_id), {'audit': 0, 'sponsor': 0})
        u[kind] = u.get(kind, 0) + 1
        u['owner'] = is_owner(chat_id)
        _save(data)


def refund(chat_id, kind: str) -> None:
    """Вернуть попытку при сбое сервиса (не по вине пользователя)."""
    if kind not in LIMITS:
        return
    with _lock:
        data = _load()
        u = data.get(_month(), {}).get(str(chat_id))
        if u and u.get(kind, 0) > 0:
            u[kind] -= 1
            _save(data)


def check(chat_id, kind: str) -> Optional[str]:
    """None — прогон разрешён; иначе текст сообщения о исчерпанном лимите."""
    if is_owner(chat_id) or kind not in LIMITS:
        return None
    with _lock:
        used = _load().get(_month(), {}).get(str(chat_id), {}).get(kind, 0)
    if used < LIMITS[kind]:
        return None
    now = datetime.now(MSK)
    nxt = (now.replace(day=1) + timedelta(days=32)).replace(day=1)
    what = 'аудит плана' if kind == 'audit' else 'отчёт для спонсора'
    return (f'🔒 Бесплатно — 1 аудит плана и 1 отчёт для спонсора в месяц. '
            f'Ваш лимит на «{what}» в этом месяце уже использован — '
            f'следующая попытка будет доступна с {nxt.strftime("%d.%m.%Y")}.\n'
            f'Если нужно больше — напишите владельцу сервиса: @plaxotin.')


def myusage_text(chat_id) -> str:
    """Остаток бесплатных попыток для команды /myusage (для любого юзера)."""
    if is_owner(chat_id):
        return ('✅ У вас безлимитный доступ — вы владелец сервиса.\n'
                'Статистика по всем пользователям: /stats.')
    now = datetime.now(MSK)
    nxt = (now.replace(day=1) + timedelta(days=32)).replace(day=1)
    u = _load().get(_month(), {}).get(str(chat_id), {})
    a_left = max(0, LIMITS['audit'] - u.get('audit', 0))
    s_left = max(0, LIMITS['sponsor'] - u.get('sponsor', 0))
    return (f'📦 Ваш бесплатный пакет на {now.strftime("%m.%Y")}:\n'
            f'• аудит плана — осталось {a_left} из {LIMITS["audit"]}\n'
            f'• отчёт для спонсора — осталось {s_left} из {LIMITS["sponsor"]}\n'
            f'Лимит обновится {nxt.strftime("%d.%m.%Y")}.\n'
            'Конвертация .mpp в Excel — без лимита.')


def stats_text() -> str:
    """Статистика использования для владельца (/stats)."""
    data = _load()
    if not data:
        return '📊 Статистики пока нет — прогонов не было.'
    months = sorted(data.keys(), reverse=True)[:3]
    out = ['📊 Статистика использования BL-1']
    now_m = _month()
    for m in months:
        users = data.get(m) or {}
        label = 'текущий месяц' if m == now_m else m
        audits = sum(u.get('audit', 0) for u in users.values())
        sponsors = sum(u.get('sponsor', 0) for u in users.values())
        out.append(f'\n{m} ({label}): {len(users)} чатов · '
                   f'аудитов {audits} · спонсорских {sponsors}')
        rows = sorted(users.items(),
                      key=lambda kv: kv[1].get('audit', 0) + kv[1].get('sponsor', 0),
                      reverse=True)
        for cid, u in rows[:15]:
            tag = ' (вы)' if u.get('owner') else ''
            out.append(f'  {cid}{tag}: аудит {u.get("audit", 0)} · '
                       f'спонсор {u.get("sponsor", 0)}')
        if len(rows) > 15:
            out.append(f'  … ещё {len(rows) - 15} чатов')
    return '\n'.join(out)
