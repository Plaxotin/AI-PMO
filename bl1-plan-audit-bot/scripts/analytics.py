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


# ---------- Качество расписания: DCMA 14-point (адаптация) ----------
# Источник: DCMA 14-Point Schedule Assessment — де-факто стандарт проверки
# качества расписания (CPM). Три семейства проверок:
#   structure    — может ли CPM считать честные даты (логика сети)
#   realism      — правдоподобны ли даты (резервы, длительности, валидность)
#   performance  — поспевает ли проект (BEI, missed, CPLI)
# Leads/lags/типы связей/жёсткие ограничения MS Project наш парсер пока
# не извлекает — такие проверки помечаются status='n/a'.

DCMA_HIGH_DAYS = 44          # high float / high duration: > 44 рабочих дней
DCMA_THRESHOLD_PCT = 5.0     # типовой порог доли нарушений
BEI_THRESHOLD = 0.95


def schedule_health(plan: Plan, report_date: date, cpm: dict) -> dict:
    """DCMA-подобные проверки. Возвращает {'checks': [...], 'bei': float|None}.

    Каждая проверка: {'id', 'name', 'family', 'count', 'percent',
                      'threshold', 'status' ('pass'|'fail'|'n/a'), 'evidence'}.
    """
    floats = cpm.get('float_by_uid', {})
    incomplete = [t for t in plan.leaves() if t.percent_complete < 100
                  and not t.is_milestone]
    n = max(1, len(incomplete))
    checks = []

    def add(cid, name, family, items, threshold=DCMA_THRESHOLD_PCT,
            zero_tolerance=False):
        pct = round(100.0 * len(items) / n, 1)
        passed = (len(items) == 0) if zero_tolerance else (pct <= threshold)
        checks.append({
            'id': cid, 'name': name, 'family': family,
            'count': len(items), 'percent': pct, 'threshold': threshold,
            'status': 'pass' if passed else 'fail',
            'evidence': [t.name if isinstance(t, Task) else str(t)
                         for t in items[:10]],
        })

    # --- structure ---
    # D-01 Logic: у незавершённой задачи нет предшественника или последователя
    no_logic = [t for t in incomplete if not t.predecessors or not t.successors]
    add('D-01', 'Логика: задачи без связей', 'structure', no_logic)
    # D-02 Leads / D-03 Lags / D-04 Типы связей / D-05 Жёсткие ограничения
    for cid, name in (('D-02', 'Leads (отрицательные лаги)'),
                      ('D-03', 'Lags (положительные лаги)'),
                      ('D-04', 'Доля связей Finish-to-Start'),
                      ('D-05', 'Жёсткие ограничения дат')):
        checks.append({'id': cid, 'name': name, 'family': 'structure',
                       'count': 0, 'percent': 0.0, 'threshold': 0,
                       'status': 'n/a',
                       'evidence': ['парсер пока не извлекает типы связей, лаги '
                                    'и ограничения — полноценно доступно из .mpp']})

    # --- realism ---
    high_float = [t for t in incomplete if floats.get(t.uid, 0) > DCMA_HIGH_DAYS]
    add('D-06', f'Резерв > {DCMA_HIGH_DAYS} дней', 'realism', high_float)
    neg_float = [t for t in incomplete if floats.get(t.uid, 0) < 0]
    add('D-07', 'Отрицательный резерв', 'realism', neg_float, zero_tolerance=True)
    high_dur = [t for t in incomplete if (t.duration_days or 0) > DCMA_HIGH_DAYS]
    add('D-08', f'Длительность > {DCMA_HIGH_DAYS} дней', 'realism', high_dur)
    # D-09 Invalid dates: окончание в прошлом при незавершённости,
    # или начало в будущем при уже начатой задаче
    invalid = [t for t in incomplete
               if (t.finish and t.finish < report_date)
               or (t.start and t.start > report_date and t.percent_complete > 0)]
    add('D-09', 'Невалидные даты (прогноз в прошлом)', 'realism', invalid,
        zero_tolerance=True)
    # D-10 Resources: незавершённая задача без ответственного
    no_resp = [t for t in incomplete if not t.responsible]
    add('D-10', 'Задачи без ответственного', 'realism', no_resp)

    # --- performance ---
    missed = [t for t in incomplete
              if t.baseline_finish and t.finish and t.finish > t.baseline_finish]
    add('D-11', 'Срыв базовых дат окончания', 'performance', missed)

    # D-14 BEI: выполненные задачи / задачи, которые по базе должны быть
    # выполнены к дате отчёта
    bei = None
    due = [t for t in plan.leaves()
           if t.baseline_finish and t.baseline_finish <= report_date]
    if due:
        done_due = [t for t in due if t.percent_complete >= 100]
        bei = round(len(done_due) / len(due), 3)
        checks.append({
            'id': 'D-14', 'name': 'BEI (индекс выполнения базового плана)',
            'family': 'performance', 'count': len(due) - len(done_due),
            'percent': round(100.0 * (len(due) - len(done_due)) / max(1, len(due)), 1),
            'threshold': BEI_THRESHOLD,
            'status': 'pass' if bei >= BEI_THRESHOLD else 'fail',
            'evidence': [f'BEI = {bei} (выполнено {len(done_due)} из {len(due)} '
                         f'запланированных к дате отчёта)'],
        })
    else:
        checks.append({'id': 'D-14', 'name': 'BEI (индекс выполнения базового плана)',
                       'family': 'performance', 'count': 0, 'percent': 0.0,
                       'threshold': BEI_THRESHOLD, 'status': 'n/a',
                       'evidence': ['нет базовых дат — BEI не вычисляется']})

    # D-13 CPLI — упрощённо: доля критического пути с нулевым резервом.
    # Полноценный CPLI требует длины критического пути до даты отчёта — TODO(IMPL).
    crit = cpm.get('critical_uids', [])
    total = max(1, len([t for t in incomplete]))
    checks.append({'id': 'D-13', 'name': 'CPLI (индекс длины критического пути)',
                   'family': 'performance', 'count': len(crit),
                   'percent': round(100.0 * len(crit) / total, 1),
                   'threshold': 0, 'status': 'n/a',
                   'evidence': [f'критических задач: {len(crit)} '
                                f'({round(100.0 * len(crit) / total, 1)}% незавершённых) '
                                '— полный расчёт CPLI в v1.1']})

    # D-12 Critical path test — требует пересчёта сети с инжектированной
    # задержкой; для каркаса: тест считается пройденным, если критический
    # путь непрерывен (цепочка связана)
    path = cpm.get('critical_path', [])
    by_uid = plan.by_uid()
    continuous = all(
        i == 0 or path[i - 1] in by_uid.get(path[i], Task(uid='', name='')).predecessors
        for i in range(len(path))
    ) if path else False
    checks.append({'id': 'D-12', 'name': 'Тест критического пути (непрерывность)',
                   'family': 'performance', 'count': 0 if continuous else 1,
                   'percent': 0.0, 'threshold': 0,
                   'status': 'pass' if continuous else ('fail' if path else 'n/a'),
                   'evidence': [] if continuous else ['критический путь разорван — '
                                                      'проверьте логику связей']})

    return {'checks': checks, 'bei': bei}


# ---------- Освоенный объём (EVM, PMI) ----------

def compute_evm(plan: Plan, report_date: date) -> dict:
    """EVM по PMI: PV/EV/SPI.

    При наличии «Затрат» — стоимостной вес; иначе duration-weighted proxy
    (вес = длительность задачи), с пометкой proxy=True.
    PV = вес задач, которые должны завершиться к дате отчёта (по текущему плану;
    если есть база — по базовой дате).
    EV = Σ вес_i × %_i. SPI = EV / PV.
    """
    leaves = [t for t in plan.leaves() if not t.is_milestone]
    if not leaves:
        return {'available': False, 'reason': 'нет листовых задач'}

    use_cost = any(t.cost for t in leaves)
    if use_cost:
        weights = {t.uid: (t.cost or 0.0) for t in leaves}
        proxy = False
    else:
        weights = {t.uid: (t.duration_days or 0.0) for t in leaves}
        proxy = True
    total_w = sum(weights.values())
    if total_w <= 0:
        return {'available': False, 'reason': 'нет затрат и длительностей для весов'}

    pv = ev = 0.0
    for t in leaves:
        w = weights[t.uid]
        plan_finish = t.baseline_finish or t.finish
        if plan_finish and plan_finish <= report_date:
            pv += w
        ev += w * t.percent_complete / 100.0
    spi = round(ev / pv, 3) if pv > 0 else None
    return {
        'available': True, 'proxy': proxy,
        'basis': 'затраты' if not proxy else 'длительности (proxy — в плане нет затрат)',
        'pv_pct': round(100.0 * pv / total_w, 1),
        'ev_pct': round(100.0 * ev / total_w, 1),
        'spi': spi,
        'interpretation': ('проект поспевает' if spi and spi >= 0.95 else
                           'умеренное отставание' if spi and spi >= 0.8 else
                           'существенное отставание' if spi is not None else
                           'недостаточно данных'),
    }


# ---------- Сводный статус здоровья (RAG, Asana-style) ----------

def health_verdict(metrics: dict, evm: dict, violations: list,
                   sched: dict) -> dict:
    """On track / At risk / Off track — как status tag в Asana + PMI RAG.

    Возвращает {'status': 'on_track'|'at_risk'|'off_track',
                'label': str, 'reasons': [...]}.
    """
    reasons_red, reasons_yellow = [], []
    total = max(1, metrics['tasks_total'])
    overdue_pct = 100.0 * metrics['overdue'] / total
    score = compliance_score(violations)
    spi = evm.get('spi') if evm.get('available') else None
    bei = sched.get('bei')
    fails = [c for c in sched.get('checks', []) if c['status'] == 'fail']
    structure_fails = [c for c in fails if c['family'] == 'structure']

    if overdue_pct > 15:
        reasons_red.append(f'просрочено {metrics["overdue"]} задач ({overdue_pct:.0f}%)')
    elif metrics['overdue'] > 0:
        reasons_yellow.append(f'есть просроченные задачи ({metrics["overdue"]})')
    if spi is not None:
        if spi < 0.8:
            reasons_red.append(f'SPI = {spi} (существенное отставание)')
        elif spi < 0.95:
            reasons_yellow.append(f'SPI = {spi}')
    if bei is not None:
        if bei < 0.8:
            reasons_red.append(f'BEI = {bei} (базовый план срывается)')
        elif bei < BEI_THRESHOLD:
            reasons_yellow.append(f'BEI = {bei}')
    if score < 60:
        reasons_red.append(f'соответствие Инструкции {score}/100')
    elif score < 85:
        reasons_yellow.append(f'соответствие Инструкции {score}/100')
    if structure_fails:
        reasons_yellow.append('структурные проблемы сети задач: '
                              + ', '.join(c["id"] for c in structure_fails))

    if reasons_red:
        return {'status': 'off_track', 'label': '🔴 Off track (срыв)',
                'reasons': reasons_red + reasons_yellow}
    if reasons_yellow:
        return {'status': 'at_risk', 'label': '🟡 At risk (риск срыва)',
                'reasons': reasons_yellow}
    return {'status': 'on_track', 'label': '🟢 On track (в графике)',
            'reasons': ['критических отклонений не выявлено']}


# ---------- Точка входа ----------

def run_analysis(plan: Plan, report_date: Optional[date] = None,
                 baseline_plan: Optional[Plan] = None) -> dict:
    """Все детерминированные факты по плану — вход для LLM и отчёта."""
    report_date = report_date or date.today()
    cpm = compute_cpm(plan)
    metrics = compute_metrics(plan, report_date)
    violations = check_compliance(plan, report_date, cpm)
    sched = schedule_health(plan, report_date, cpm)
    evm = compute_evm(plan, report_date)
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
        'schedule_health': sched,
        'evm': evm,
        'health': health_verdict(metrics, evm, violations, sched),
    }
    if baseline_plan is not None:
        from diff import diff_plans
        facts['diff'] = diff_plans(baseline_plan, plan)
    return facts
