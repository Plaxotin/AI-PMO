#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Краткая сводка для Telegram-чата (BL-1).

Инвертированная пирамида (Asana): статус здоровья и главное — в первых строках.
Полный разбор — в PDF; в чат уходит компактная сводка (лимит TG ~4096 символов).
"""

from plan_model import Plan

TG_LIMIT = 4000

SEVERITY_ICON = {'high': '🔴', 'medium': '🟡', 'info': 'ℹ️'}
CHECK_STATUS_ICON = {'pass': '✅', 'fail': '❌', 'n/a': '➖'}


def build_chat_summary(plan: Plan, facts: dict) -> str:
    m = facts['metrics']
    health = facts.get('health', {})
    evm = facts.get('evm', {})
    sched = facts.get('schedule_health', {})

    lines = [
        f"📋 *Аудит плана «{plan.name}»*",
        f"*{health.get('label', '—')}* · Инструкция: *{facts['compliance_score']}/100*",
        f"Дата отчёта: {facts['report_date']}",
        '',
    ]
    for reason in health.get('reasons', [])[:3]:
        lines.append(f'• {reason}')
    if health.get('reasons'):
        lines.append('')

    lines += [
        f"Задач: {m['tasks_total']} (этапов: {m['summaries']}, вех: {m['milestones']})",
        f"✅ {m['done']} · 🔄 {m['in_progress']} · ⬜ {m['not_started']} · "
        f"⏰ просрочено: {m['overdue']}",
        f"Критический путь: {facts['cpm']['critical_count']} задач",
    ]
    if evm.get('available'):
        proxy_mark = ' (proxy по длительностям)' if evm.get('proxy') else ''
        spi = evm.get('spi')
        lines.append(f"SPI: {spi if spi is not None else '—'}{proxy_mark} — "
                     f"{evm.get('interpretation', '')}")
    lines.append('')

    fails = [c for c in sched.get('checks', []) if c['status'] == 'fail']
    if fails:
        lines.append('*Провалы качества расписания (DCMA):*')
        for c in fails[:6]:
            lines.append(f"❌ {c['id']} {c['name']} — {c['count']} шт. "
                         f"({c['percent']}%)")
        lines.append('')

    if facts['compliance']:
        lines.append('*Нарушения Инструкции:*')
        for v in facts['compliance'][:8]:
            icon = SEVERITY_ICON.get(v['severity'], '•')
            lines.append(f"{icon} {v['rule']} — {v['count']} шт.")
        lines.append('')

    diff = facts.get('diff')
    if diff:
        lines.append('*Изменения к предыдущей версии:*')
        lines.append(f"➕ {diff['added_count']} · ➖ {diff['removed_count']} · "
                     f"📅 сдвигов сроков: {diff['shifted_count']} · "
                     f"📈 изменений прогресса: {diff['progress_count']}")
        lines.append('')

    lines.append('Подробный разбор и рекомендации — в PDF ниже ⬇️')

    text = '\n'.join(lines)
    return text[:TG_LIMIT - 1] + '…' if len(text) > TG_LIMIT else text
