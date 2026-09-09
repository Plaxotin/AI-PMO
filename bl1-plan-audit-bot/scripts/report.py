#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Краткая сводка для Telegram-чата (BL-1).

Инвертированная пирамида (Asana): статус здоровья и главное — в первых строках.
Все метрики объясняются простым языком прямо в тексте (фидбек от 10.09.2026:
пользователю непонятны SPI/BEI/DCMA и строка «✅ 47 · 🔄 75 · ⬜ 390»).
Коды правил R-NN и упоминания корпоративной Инструкции из вывода убраны —
правила используются только внутри анализа.
Полный разбор — в PDF; в чат уходит компактная сводка (лимит TG ~4096 символов).
"""

import re

from plan_model import Plan

TG_LIMIT = 4000

SEVERITY_ICON = {'high': '🔴', 'medium': '🟡', 'info': 'ℹ️'}


def _spi_line(evm: dict) -> str:
    """SPI простым языком: на сколько % от графика выполняются работы."""
    spi = evm.get('spi')
    if spi is None:
        return ''
    pct = round(spi * 100)
    if spi >= 0.95:
        verdict = 'проект поспевает за графиком'
    elif spi >= 0.8:
        verdict = 'умеренное отставание'
    else:
        verdict = f'отставание примерно в {round(1 / spi, 1)} раза'
    basis = ' (оценка по длительностям — в плане нет затрат)' \
        if evm.get('proxy') else ''
    return (f"⏱ Темп выполнения: работы идут на {pct} % от графика "
            f"— {verdict}{basis}")


def _bei_line(sched: dict) -> str:
    """BEI простым языком: доля запланированных к сегодня задач, которые выполнены."""
    bei = sched.get('bei')
    if bei is None:
        return ''
    detail = ''
    for c in sched.get('checks', []):
        if c['id'] == 'D-14' and c.get('evidence'):
            m_ev = re.search(r'выполнено (\d+) из (\d+)', c['evidence'][0])
            if m_ev:
                detail = f" ({m_ev.group(1)} из {m_ev.group(2)} задач)"
            break
    return (f"📌 Базовый план: из задач, которые должны быть завершены "
            f"к сегодня, выполнено {round(bei * 100)} %{detail}")


def build_chat_summary(plan: Plan, facts: dict) -> str:
    m = facts['metrics']
    health = facts.get('health', {})
    evm = facts.get('evm', {})
    sched = facts.get('schedule_health', {})

    lines = [
        f"📋 *Аудит плана «{plan.name}»*",
        f"*{health.get('label', '—')}* · дата отчёта: {facts['report_date']}",
        '',
    ]
    for reason in health.get('reasons', [])[:3]:
        lines.append(f'• {reason}')
    if health.get('reasons'):
        lines.append('')

    overdue_pct = round(100.0 * m['overdue'] / max(1, m['tasks_total']))
    lines += [
        f"Всего задач: {m['tasks_total']} (в т.ч. этапов: {m['summaries']}, "
        f"вех: {m['milestones']})",
        f"✅ Выполнено: {m['done']} · 🔄 В работе: {m['in_progress']} · "
        f"⬜ Не начато: {m['not_started']}",
        f"⏰ Просрочено: {m['overdue']} ({overdue_pct} %) — срок вышел, "
        f"работа не завершена",
        f"🔗 Критический путь: {facts['cpm']['critical_count']} задач — задержка "
        f"любой из них сдвигает весь проект",
    ]
    if evm.get('available'):
        line = _spi_line(evm)
        if line:
            lines.append(line)
    line = _bei_line(sched)
    if line:
        lines.append(line)
    lines.append('')

    fails = [c for c in sched.get('checks', []) if c['status'] == 'fail']
    if fails:
        lines.append('*Качество плана — что не так* '
                     '(норма: проблем ≤ 5 % задач):')
        for c in fails[:6]:
            lines.append(f"❌ {c['name']} — {c['count']} шт. ({c['percent']} %)")
        lines.append('')

    if facts['compliance']:
        lines.append('*Требования к оформлению плана:*')
        for v in facts['compliance'][:8]:
            icon = SEVERITY_ICON.get(v['severity'], '•')
            lines.append(f"{icon} {v.get('title', v['rule'])} — {v['count']} шт.")
        lines.append('')

    diff = facts.get('diff')
    if diff:
        lines.append('*Изменения к предыдущей версии:*')
        lines.append(f"➕ новых задач: {diff['added_count']} · "
                     f"➖ удалено: {diff['removed_count']} · "
                     f"📅 сдвигов сроков: {diff['shifted_count']} · "
                     f"📈 изменений прогресса: {diff['progress_count']}")
        lines.append('')

    lines.append('Подробный разбор и рекомендации — в PDF ниже ⬇️')

    text = '\n'.join(lines)
    return text[:TG_LIMIT - 1] + '…' if len(text) > TG_LIMIT else text
