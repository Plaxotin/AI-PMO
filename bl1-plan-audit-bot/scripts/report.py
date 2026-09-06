#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Краткая сводка для Telegram-чата (BL-1).

Полный разбор — в PDF; в чат уходит компактная сводка (лимит TG ~4096 символов).
"""

from plan_model import Plan

TG_LIMIT = 4000

SEVERITY_ICON = {'high': '🔴', 'medium': '🟡', 'info': 'ℹ️'}


def build_chat_summary(plan: Plan, facts: dict) -> str:
    m = facts['metrics']
    lines = [
        f"📋 *Аудит плана «{plan.name}»*",
        f"Дата отчёта: {facts['report_date']} · формат: {facts['source_format']}",
        '',
        f"Задач: {m['tasks_total']} (этапов: {m['summaries']}, вех: {m['milestones']})",
        f"✅ {m['done']} · 🔄 {m['in_progress']} · ⬜ {m['not_started']} · "
        f"⏰ просрочено: {m['overdue']}",
        f"Критический путь: {facts['cpm']['critical_count']} задач",
        f"Соответствие Инструкции: *{facts['compliance_score']}/100*",
        '',
    ]
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
