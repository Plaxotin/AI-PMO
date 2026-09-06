#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Детерминированный анализ плана (BL-1) — БЕЗ LLM.

CPM, метрики, проверка правил корпоративной Инструкции R-01…R-12.
Результат — факты (JSON-совместимый dict); LLM в llm.py только интерпретирует их.
"""

from datetime import date
from typing import Optional

from plan_model import Plan, Task

# Пороги (из спеки / Инструкции)
CRITICAL_FLOAT_DAYS = 5        # R-03: резерв ≤ 5 дней = критическая
BASELINE_SHIFT_DAYS = 30       # R-11: отклонение от базы > 30 дней без ЗнИ


# ---------- CPM ----------

def compute_cpm(plan: Plan) -> dict:
    """Метод критического пути по листовым задачам (FS-связи, длительность в днях).

    Возвращает {'float_by_uid': {...}, 'critical_uids': [...], 'critical_path': [...]}.
    critical_path — самая длинная цепочка (упрощение для каркаса).
    TODO(IMPL): учесть типы связей (SS/FF), лаги, календари.
    """
    leaves = [t for t in plan.leaves() if t.duration_days is not None]
    by_uid = {t.uid: t for t in leaves}
    preds = {t.uid: [p for p in t.predecessors if p in by_uid] for t in leaves}

    # Прямой проход: EF = ES + duration
    es, ef = {}, {}

    def forward(uid, stack=()):
        if uid in ef:
            return
        if uid in stack:
            return  # цикл — пропускаем (фиксируется как ошибка валидации)
        best = 0.0
        for p in preds.get(uid, []):
            forward(p, stack + (uid,))
            best = max(best, ef.get(p, 0.0))
        es[uid] = best
        ef[uid] = best + (by_uid[uid].duration_days or 0.0)

    for t in leaves:
        forward(t.uid)
    if not ef:
        return {'float_by_uid': {}, 'critical_uids': [], 'critical_path': []}

    project_ef = max(ef.values())
    # Обратный проход: LF = min(LS последователей), LS = LF - duration
    succs = {t.uid: [s for s in t.successors if s in by_uid] for t in leaves}
    lf = {}

    def backward(uid, stack=()):
        if uid in lf:
            return
        if uid in stack:
            return
        ss = succs.get(uid, [])
        if not ss:
            lf[uid] = project_ef
        else:
            best = None
            for s in ss:
                backward(s, stack + (uid,))
                ls = lf.get(s, project_ef) - (by_uid[s].duration_days or 0.0)
                best = ls if best is None else min(best, ls)
            lf[uid] = best if best is not None else project_ef

    for t in leaves:
        backward(t.uid)

    floats = {uid: lf[uid] - ef[uid] for uid in ef}
    critical = sorted([u for u, f in floats.items() if f <= CRITICAL_FLOAT_DAYS])
    # Цепочка критического пути: жадно от конечной задачи с max EF
    path, cur = [], None
    ends = [u for u in ef if not succs.get(u)] or list(ef)
    cur = max(ends, key=lambda u: ef[u])
    while cur:
        path.append(cur)
        ps = [p for p in preds.get(cur, []) if floats.get(p, 999) <= CRITICAL_FLOAT_DAYS]
        cur = max(ps, key=lambda u: ef[u]) if ps else None
    path.reverse()
    return {'float_by_uid': floats, 'critical_uids': critical, 'critical_path': path}


# ---------- Метрики ----------

def compute_metrics(plan: Plan, report_date: date) -> dict:
    leaves = plan.leaves()
    done = [t for t in leaves if t.percent_complete >= 100]
    in_progress = [t for t in leaves if 0 < t.percent_complete < 100]
    not_started = [t for t in leaves if t.percent_complete == 0]
    overdue = [t for t in leaves
               if t.finish and t.finish < report_date and t.percent_complete < 100]
    return {
        'tasks_total': len(leaves),
        'summaries': len(plan.summaries()),
        'milestones': len(plan.milestones()),
        'done': len(done),
        'in_progress': len(in_progress),
        'not_started': len(not_started),
        'overdue': len(overdue),
        'overdue_names': [t.name for t in overdue[:20]],
    }


# ---------- Правила Инструкции R-01…R-12 ----------

def check_compliance(plan: Plan, report_date: date, cpm: dict) -> list:
    """Возвращает список нарушений:
    [{'rule': 'R-01', 'severity': 'high', 'count': N, 'evidence': [...], 'ref': 'п. 1'}]
    """
    v = []
    leaves = plan.leaves()
    cols = set(plan.columns_found)

    def add(rule, severity, items, ref):
        if items:
            v.append({'rule': rule, 'severity': severity, 'count': len(items),
                      'evidence': items[:10], 'ref': ref})

    # R-01: «подвисшие» задачи — нет ни предшественников, ни последователей
    dangling = [t.name for t in leaves
                if not t.predecessors and not t.successors and not t.is_milestone]
    add('R-01', 'high', dangling, 'п. 1: всем задачам — предшественники и последователи')

    # R-02: суммарные задачи со связями
    linked_sum = [t.name for t in plan.summaries() if t.predecessors or t.successors]
    add('R-02', 'high', linked_sum, 'п. 1: суммарным задачам связи не назначаются')

    # R-03: резерв критических > 5 дней не бывает — инфо-сверка с CPM
    floats = cpm.get('float_by_uid', {})
    suspicious = [t.name for t in leaves
                  if floats.get(t.uid, 0) > CRITICAL_FLOAT_DAYS
                  and t.percent_complete == 100 and t.finish and t.finish > report_date]
    add('R-03', 'info', suspicious, 'п. 1: критические задачи — резерв ≤ 5 дней')

    # R-04: контрольные вехи без крайнего срока или с длительностью ≠ 0
    bad_ms = [t.name for t in plan.milestones()
              if not t.deadline or (t.duration_days or 0) != 0]
    add('R-04', 'high', bad_ms, 'п. 1: вехам УК — крайний срок + длительность 0')

    # R-05: раздел ключевых вех
    has_ms_section = any('вех' in t.name.lower() for t in plan.summaries())
    if not has_ms_section and plan.milestones():
        add('R-05', 'medium', ['нет раздела «Ключевые вехи»'],
            'п. 1: этапы с вехами выносятся в отдельный раздел')

    # R-06: затраты = 100 и заполнены у листьев
    if 'cost' not in cols:
        add('R-06', 'medium', ['колонка «Затраты» отсутствует'],
            'п. 1: затраты суммарно = 100 ₽, декомпозиция до ключевых работ')
    else:
        total = sum(t.cost or 0 for t in leaves)
        if abs(total - 100) > 0.5:
            add('R-06', 'medium', [f'сумма затрат листьев = {total:.1f} ≠ 100'],
                'п. 1: сумма затрат = 100 ₽')

    # R-07: базовый план сохранён
    if 'baseline_start' not in cols or 'baseline_finish' not in cols:
        add('R-07', 'high', ['отсутствуют поля базового плана'],
            'п. 1: базовый план сохранён')
    else:
        no_base = [t.name for t in leaves if not t.baseline_finish]
        add('R-07', 'high', no_base, 'п. 1: у всех задач есть базовые сроки')

    # R-08: рекомендованный состав колонок
    recommended = ['baseline_start', 'baseline_finish', 'cost', 'deadline']
    missing = [c for c in recommended if c not in cols]
    if missing:
        add('R-08', 'medium', [f'нет колонок: {", ".join(missing)}'],
            'п. 1: рекомендованный состав колонок')

    # R-09: сроки «в прошлом»
    overdue = [t.name for t in leaves
               if t.finish and t.finish < report_date and t.percent_complete < 100]
    add('R-09', 'high', overdue, 'разд. 4–5: сроки «в прошлом» недопустимы')

    # R-10: неначатые по графику не актуализированы
    stale = [t.name for t in leaves
             if t.start and t.start < report_date and t.percent_complete == 0]
    add('R-10', 'medium', stale, 'разд. 4: неначатые по графику задачи актуализируются')

    # R-11/R-12: отклонения от базового плана
    shifted = []
    for t in leaves:
        if t.baseline_finish and t.finish:
            delta = (t.finish - t.baseline_finish).days
            if delta > BASELINE_SHIFT_DAYS:
                shifted.append(f'{t.name} (+{delta} дн.)')
    add('R-11', 'medium', shifted,
        f'разд. 5: отклонение от базы > {BASELINE_SHIFT_DAYS} дн. без фиксации ЗнИ')

    dev = [t.name for t in leaves
           if t.baseline_finish and t.finish and t.finish != t.baseline_finish]
    add('R-12', 'info', dev, 'разд. 4: отклонение окончания от базовой даты')

    return v


def compliance_score(violations: list) -> int:
    """100 − Σ(вес severity × нормированный count). Веса: high=5, medium=2, info=0.5."""
    weights = {'high': 5.0, 'medium': 2.0, 'info': 0.5}
    penalty = sum(weights.get(x['severity'], 1.0) * min(x['count'], 20) / 20
                  for x in violations)
    return max(0, round(100 - penalty))


# ---------- Точка входа ----------

def run_analysis(plan: Plan, report_date: Optional[date] = None,
                 baseline_plan: Optional[Plan] = None) -> dict:
    """Все детерминированные факты по плану — вход для LLM и отчёта."""
    report_date = report_date or date.today()
    cpm = compute_cpm(plan)
    metrics = compute_metrics(plan, report_date)
    violations = check_compliance(plan, report_date, cpm)
    facts = {
        'plan_name': plan.name,
        'source_format': plan.source_format,
        'report_date': report_date.isoformat(),
        'metrics': metrics,
        'cpm': {
            'critical_count': len(cpm['critical_uids']),
            'critical_path_names': [plan.by_uid()[u].name for u in cpm['critical_path']
                                    if u in plan.by_uid()][:30],
        },
        'compliance': violations,
        'compliance_score': compliance_score(violations),
    }
    if baseline_plan is not None:
        from diff import diff_plans
        facts['diff'] = diff_plans(baseline_plan, plan)
    return facts
