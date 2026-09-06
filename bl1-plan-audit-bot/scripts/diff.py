#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сравнение двух версий плана (BL-1): базовая vs текущая.

Матчинг задач — по uid, при отсутствии совпадения — по нормализованному имени.
"""

from plan_model import Plan


def _norm(name: str) -> str:
    return ' '.join(name.lower().split())


def diff_plans(old: Plan, new: Plan) -> dict:
    """Возвращает {'added', 'removed', 'shifted', 'progress', 'renamed'} —
    списки человекочитаемых изменений (ограничены для отчёта)."""
    old_by_uid = old.by_uid()
    new_by_uid = new.by_uid()
    old_names = {_norm(t.name): t for t in old.tasks}
    new_names = {_norm(t.name): t for t in new.tasks}

    added, removed, shifted, progress = [], [], [], []

    matched_new = set()
    for uid, t in old_by_uid.items():
        nt = new_by_uid.get(uid) or new_names.get(_norm(t.name))
        if nt is None:
            removed.append(t.name)
            continue
        matched_new.add(nt.uid)
        if t.finish and nt.finish and t.finish != nt.finish:
            delta = (nt.finish - t.finish).days
            shifted.append(f'{t.name}: окончание {t.finish} → {nt.finish} ({delta:+d} дн.)')
        if t.percent_complete != nt.percent_complete:
            progress.append(f'{t.name}: {t.percent_complete:.0f}% → {nt.percent_complete:.0f}%')

    for uid, t in new_by_uid.items():
        if uid not in matched_new and uid not in old_by_uid \
                and _norm(t.name) not in old_names:
            added.append(t.name)

    return {
        'added': added[:20], 'added_count': len(added),
        'removed': removed[:20], 'removed_count': len(removed),
        'shifted': shifted[:20], 'shifted_count': len(shifted),
        'progress': progress[:20], 'progress_count': len(progress),
    }
