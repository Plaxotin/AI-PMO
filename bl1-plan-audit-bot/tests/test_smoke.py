#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Smoke-тесты каркаса BL-1: импорты + мини-проверка CPM."""

import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from plan_model import Plan, Task          # noqa: E402
from analytics import compute_cpm, run_analysis  # noqa: E402
from diff import diff_plans                # noqa: E402


def _t(uid, name, dur, preds=(), finish_offset=10):
    return Task(uid=uid, name=name, duration_days=dur, predecessors=list(preds),
                start=date(2026, 9, 1),
                finish=date(2026, 9, 1) + timedelta(days=finish_offset))


def test_cpm_basic():
    # A(5) → B(3) → C(2) и параллельно D(1) — критический путь A→B→C
    plan = Plan(name='t', source_format='xlsx', tasks=[
        _t('1', 'A', 5), _t('2', 'B', 3, ['1']), _t('3', 'C', 2, ['2']),
        _t('4', 'D', 1),
    ])
    for t in plan.tasks:
        for p in t.predecessors:
            plan.by_uid()[p].successors.append(t.uid)
    cpm = compute_cpm(plan)
    assert cpm['critical_path'] == ['1', '2', '3'], cpm['critical_path']
    assert cpm['float_by_uid']['4'] > 0


def test_run_analysis_and_diff():
    old = Plan(name='v1', source_format='xlsx', tasks=[_t('1', 'A', 5)])
    new = Plan(name='v2', source_format='xlsx',
               tasks=[_t('1', 'A', 5, finish_offset=15), _t('2', 'B', 2)])
    d = diff_plans(old, new)
    assert d['added_count'] == 1 and d['shifted_count'] == 1
    facts = run_analysis(new, report_date=date(2026, 9, 6), baseline_plan=old)
    assert facts['metrics']['tasks_total'] == 2
    assert 'diff' in facts and facts['compliance_score'] >= 0


if __name__ == '__main__':
    test_cpm_basic()
    test_run_analysis_and_diff()
    print('smoke OK')
