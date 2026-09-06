#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Smoke-тесты каркаса BL-1: импорты, CPM, DCMA-проверки, EVM, дифф, PDF."""

import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from plan_model import Plan, Task          # noqa: E402
from analytics import (compute_cpm, run_analysis, schedule_health,  # noqa: E402
                       compute_evm, health_verdict)
from diff import diff_plans                # noqa: E402


def _t(uid, name, dur, preds=(), finish_offset=10, pct=0.0, base_off=None):
    return Task(uid=uid, name=name, duration_days=dur, predecessors=list(preds),
                percent_complete=pct,
                start=date(2026, 9, 1),
                finish=date(2026, 9, 1) + timedelta(days=finish_offset),
                baseline_finish=(date(2026, 9, 1) + timedelta(days=base_off)
                                 if base_off is not None else None))


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
    assert facts['health']['status'] in ('on_track', 'at_risk', 'off_track')
    assert facts['schedule_health']['checks']


def test_schedule_health_and_evm():
    rd = date(2026, 9, 20)
    plan = Plan(name='h', source_format='xlsx', tasks=[
        _t('1', 'A', 5, pct=100, base_off=5),          # выполнена в срок
        _t('2', 'B', 50, ['1'], pct=10, base_off=6),   # high duration + срыв базы
        _t('3', 'C', 3),                               # без связей, без базы
    ])
    for t in plan.tasks:
        for p in t.predecessors:
            plan.by_uid()[p].successors.append(t.uid)
    cpm = compute_cpm(plan)
    sched = schedule_health(plan, rd, cpm)
    by_id = {c['id']: c for c in sched['checks']}
    assert by_id['D-08']['count'] >= 1            # B длиннее 44 дней
    assert by_id['D-01']['count'] >= 1            # C без связей
    assert sched['bei'] is not None and sched['bei'] < 1.0
    evm = compute_evm(plan, rd)
    assert evm['available'] and evm['proxy']
    verdict = health_verdict({'tasks_total': 3, 'overdue': 0},
                             evm, [], sched)
    assert verdict['status'] in ('on_track', 'at_risk', 'off_track')


def test_pdf_build(tmp_path=None):
    import tempfile
    out = os.path.join(tempfile.mkdtemp(), 'report.pdf')
    from pdf import generate_pdf
    from report import build_chat_summary
    new = Plan(name='demo', source_format='xlsx',
               tasks=[_t('1', 'A', 5, pct=100, base_off=5),
                      _t('2', 'B', 10, ['1'], pct=30, base_off=12)])
    for t in new.tasks:
        for p in t.predecessors:
            plan_uid = new.by_uid().get(p)
            if plan_uid:
                plan_uid.successors.append(t.uid)
    facts = run_analysis(new, report_date=date(2026, 9, 6))
    summary = build_chat_summary(new, facts)
    assert 'Аудит плана' in summary
    generate_pdf(new, facts, '## Резюме для руководства\nТест **жирный** текст.',
                 out)
    assert os.path.getsize(out) > 3000


if __name__ == '__main__':
    test_cpm_basic()
    test_run_analysis_and_diff()
    test_schedule_health_and_evm()
    test_pdf_build()
    print('smoke OK')
