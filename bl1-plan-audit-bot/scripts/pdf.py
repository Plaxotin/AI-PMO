#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Упрощённый PDF-отчёт (BL-1): сводка + таблицы + заключение LLM.

Решением от 06.09.2026 — без диаграмм D-01…D-04 (упрощённый шаблон).
Шрифт с кириллицей: DejaVu Sans (ставится на сервер пакетом fonts-dejavu).
"""

import os
from typing import Optional

from plan_model import Plan

FONT_PATHS = (
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'DejaVuSans.ttf',
)


def _register_font():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    for p in FONT_PATHS:
        if os.path.exists(p):
            pdfmetrics.registerFont(TTFont('AppFont', p))
            return 'AppFont'
    return 'Helvetica'  # fallback: кириллица не отрендерится — см. README деплоя


def generate_pdf(plan: Plan, facts: dict, llm_text: Optional[str],
                 out_path: str) -> str:
    """Собирает PDF в out_path, возвращает путь."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                    Table, TableStyle)
    from reportlab.lib import colors

    font = _register_font()
    h1 = ParagraphStyle('h1', fontName=font, fontSize=16, spaceAfter=6 * mm)
    h2 = ParagraphStyle('h2', fontName=font, fontSize=12, spaceBefore=4 * mm,
                        spaceAfter=2 * mm)
    body = ParagraphStyle('body', fontName=font, fontSize=9, leading=12)
    small = ParagraphStyle('small', fontName=font, fontSize=8, leading=10)

    doc = SimpleDocTemplate(out_path, pagesize=A4,
                            leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm)
    story = [Paragraph(f'Аудит проектного плана «{plan.name}»', h1),
             Paragraph(f"Дата отчёта: {facts['report_date']} · "
                       f"Соответствие Инструкции: {facts['compliance_score']}/100",
                       body),
             Spacer(1, 4 * mm)]

    # --- Метрики ---
    m = facts['metrics']
    story.append(Paragraph('Метрики плана', h2))
    tbl = Table([
        ['Задач', 'Этапов', 'Вех', 'Выполнено', 'В работе', 'Не начато', 'Просрочено'],
        [str(m['tasks_total']), str(m['summaries']), str(m['milestones']),
         str(m['done']), str(m['in_progress']), str(m['not_started']),
         str(m['overdue'])],
    ])
    tbl.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), font),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.25, colors.grey),
        ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
    ]))
    story.append(tbl)

    # --- Нарушения Инструкции ---
    if facts['compliance']:
        story.append(Paragraph('Соответствие Инструкции (R-01…R-12)', h2))
        rows = [['Правило', 'Важность', 'Кол-во', 'Примеры (evidence)']]
        for v in facts['compliance']:
            rows.append([v['rule'], v['severity'], str(v['count']),
                         '; '.join(v['evidence'][:3])])
        tbl = Table(rows, colWidths=[18 * mm, 20 * mm, 15 * mm, 120 * mm])
        tbl.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), font),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.25, colors.grey),
            ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        story.append(tbl)

    # --- Дифф ---
    diff = facts.get('diff')
    if diff:
        story.append(Paragraph('Изменения к предыдущей версии', h2))
        for line in (diff['shifted'] + diff['added'][:5] + diff['removed'][:5]):
            story.append(Paragraph('• ' + line, small))

    # --- Заключение LLM ---
    if llm_text:
        story.append(Paragraph('Заключение аудитора', h2))
        # TODO(IMPL): полноценный Markdown→PDF; пока — построчно с заголовками ##
        for line in llm_text.splitlines():
            s = line.strip()
            if not s:
                story.append(Spacer(1, 1.5 * mm))
            elif s.startswith('##'):
                story.append(Paragraph(s.lstrip('#').strip(), h2))
            else:
                story.append(Paragraph(s.replace('**', ''), body))

    doc.build(story)
    return out_path
