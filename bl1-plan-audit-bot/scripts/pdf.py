#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PDF-отчёт BL-1 — структура по лучшим практикам PMI / Asana / DCMA.

Секции: шапка со статусом здоровья (RAG) → ключевые метрики → качество
расписания (DCMA-проверки с pass/fail) → освоенный объём (SPI) →
соответствие Инструкции → дифф → заключение аудитора (LLM).

Решением от 06.09.2026 — без диаграмм D-01…D-04 (упрощённый шаблон).
Шрифт с кириллицей: DejaVu Sans (пакет fonts-dejavu на сервере).
"""

import os
import re
from typing import Optional

from plan_model import Plan

FONT_PATHS = (
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'DejaVuSans.ttf',
    'C:/Windows/Fonts/arial.ttf',      # локальная отладка на Windows
)
FONT_BOLD_PATHS = (
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    'DejaVuSans-Bold.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
)

STATUS_LABELS = {
    'on_track': 'ON TRACK — в графике',
    'at_risk': 'AT RISK — риск срыва',
    'off_track': 'OFF TRACK — срыв',
}

STATUS_COLORS = {
    'on_track': (0.13, 0.55, 0.13),   # зелёный
    'at_risk': (0.85, 0.55, 0.0),     # янтарный
    'off_track': (0.75, 0.1, 0.1),    # красный
}


def _register_fonts():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    regular = bold = None
    for p in FONT_PATHS:
        if os.path.exists(p):
            pdfmetrics.registerFont(TTFont('AppFont', p))
            regular = 'AppFont'
            break
    for p in FONT_BOLD_PATHS:
        if os.path.exists(p):
            pdfmetrics.registerFont(TTFont('AppFont-Bold', p))
            bold = 'AppFont-Bold'
            break
    if regular and bold:
        # Чтобы <b> в Paragraph подхватывал жирное начертание
        pdfmetrics.registerFontFamily(regular, normal=regular, bold=bold,
                                      italic=regular, boldItalic=bold)
    return regular or 'Helvetica', bold or (regular or 'Helvetica')


def _md_inline(text: str) -> str:
    """Мини-Markdown для Paragraph: **bold** → <b>, экранирование XML."""
    text = (text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    return text


# Эмодзи не входят в DejaVu/Arial → заменяем на цветные маркеры / чистим,
# чтобы в PDF не было «тофу»-квадратов.
_EMOJI_DOTS = {
    '🟢': '#1e8c1e', '🟡': '#d98c00', '🔴': '#bf1a1a',
}
_EMOJI_RE = re.compile(
    '[\U0001F300-\U0001FAFF\U00002600-\U000026CF\U000026D4-\U000027BF'
    '\U0001F1E6-\U0001F1FF\U00002B00-\U00002BFF\uFE0F]')


def _pdf_safe(text: str) -> str:
    """После _md_inline: светофорные эмодзи → цветные ●, прочие — удалить."""
    for emoji, color in _EMOJI_DOTS.items():
        text = text.replace(emoji, f"<font color='{color}'>●</font>")
    return _EMOJI_RE.sub('', text)


def generate_pdf(plan: Plan, facts: dict, llm_text: Optional[str],
                 out_path: str) -> str:
    """Собирает PDF в out_path, возвращает путь."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                    Table, TableStyle)
    from reportlab.lib import colors

    font, font_bold = _register_fonts()
    h1 = ParagraphStyle('h1', fontName=font_bold, fontSize=16, spaceAfter=2 * mm)
    h2 = ParagraphStyle('h2', fontName=font_bold, fontSize=12,
                        spaceBefore=4 * mm, spaceAfter=2 * mm)
    body = ParagraphStyle('body', fontName=font, fontSize=9, leading=12.5)
    bullet = ParagraphStyle('bullet', parent=body, leftIndent=4 * mm,
                            bulletIndent=1 * mm)
    small = ParagraphStyle('small', fontName=font, fontSize=8, leading=10)

    def base_table_style(extra=()):
        return TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), font),
            ('FONTNAME', (0, 0), (-1, 0), font_bold),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.25, colors.grey),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#EAEAEA')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ] + list(extra))

    doc = SimpleDocTemplate(out_path, pagesize=A4,
                            leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm)
    health = facts.get('health', {})
    status = health.get('status', 'at_risk')
    sc = STATUS_COLORS.get(status, (0.5, 0.5, 0.5))

    story = [Paragraph(f'Аудит проектного плана «{plan.name}»', h1),
             Paragraph(f"Дата отчёта: {facts['report_date']} · "
                       f"Источник: {facts['source_format']}", small),
             Spacer(1, 3 * mm)]

    # --- Шапка здоровья (RAG, Asana-style) ---
    status_label = STATUS_LABELS.get(status, health.get('label', '—'))
    rag = Table([[Paragraph(f"<font color='white'><b>{status_label}</b>"
                            f"&nbsp;&nbsp;·&nbsp;&nbsp;Инструкция: "
                            f"{facts['compliance_score']}/100</font>", body)]],
                colWidths=[180 * mm])
    rag.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), colors.Color(*sc)),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(rag)
    for reason in health.get('reasons', [])[:5]:
        story.append(Paragraph('• ' + _pdf_safe(_md_inline(reason)), bullet))

    # --- Ключевые метрики ---
    m = facts['metrics']
    story.append(Paragraph('Ключевые метрики', h2))
    evm = facts.get('evm', {})
    spi_txt = '—'
    if evm.get('available') and evm.get('spi') is not None:
        spi_txt = str(evm['spi']) + (' (proxy)' if evm.get('proxy') else '')
    bei = facts.get('schedule_health', {}).get('bei')
    tbl = Table([
        ['Задач', 'Выполнено', 'В работе', 'Не начато', 'Просрочено',
         'Крит. путь', 'SPI', 'BEI'],
        [str(m['tasks_total']), str(m['done']), str(m['in_progress']),
         str(m['not_started']), str(m['overdue']),
         str(facts['cpm']['critical_count']), spi_txt,
         str(bei) if bei is not None else '—'],
    ])
    tbl.setStyle(base_table_style())
    story.append(tbl)
    if evm.get('available'):
        story.append(Paragraph(
            f"Освоенный объём (PMI): PV = {evm['pv_pct']} %, EV = {evm['ev_pct']} % "
            f"от общего объёма; база весов — {evm['basis']}. "
            f"Интерпретация: {evm['interpretation']}.", small))

    # --- Качество расписания (DCMA) ---
    sched = facts.get('schedule_health', {})
    checks = sched.get('checks', [])
    if checks:
        story.append(Paragraph('Качество расписания (по методологии DCMA)', h2))
        icon = {'pass': 'да', 'fail': 'НЕТ', 'n/a': '—'}
        family_names = {'structure': 'Структура сети', 'realism': 'Реалистичность',
                        'performance': 'Исполнение'}
        rows = [['OK', 'Проверка', 'Семейство', 'Нарушений', 'Доля']]
        row_colors = []
        for c in checks:
            rows.append([icon.get(c['status'], '?'), c['name'],
                         family_names.get(c['family'], c['family']),
                         str(c['count']) if c['status'] != 'n/a' else '—',
                         f"{c['percent']} %" if c['status'] != 'n/a' else 'н/д'])
            if c['status'] == 'fail':
                row_colors.append(len(rows) - 1)
        tbl = Table(rows, colWidths=[12 * mm, 62 * mm, 30 * mm, 22 * mm, 18 * mm])
        style = [('TEXTCOLOR', (0, r), (0, r), colors.red)
                 for r in row_colors]
        tbl.setStyle(base_table_style(style))
        story.append(tbl)
        fails = [c for c in checks if c['status'] == 'fail']
        for c in fails[:4]:
            if c['evidence']:
                story.append(Paragraph(
                    f"<b>{c['id']}</b>: {_pdf_safe(_md_inline('; '.join(c['evidence'][:3])))}",
                    small))

    # --- Соответствие Инструкции ---
    if facts['compliance']:
        story.append(Paragraph('Соответствие корпоративной Инструкции (R-01…R-12)', h2))
        cell = ParagraphStyle('cell', parent=small)
        rows = [['Правило', 'Важность', 'Кол-во', 'Пункт', 'Примеры']]
        for v in facts['compliance']:
            rows.append([v['rule'], v['severity'], str(v['count']),
                         Paragraph(_pdf_safe(_md_inline(v.get('ref', ''))), cell),
                         Paragraph(_pdf_safe(_md_inline('; '.join(v['evidence'][:2]))), cell)])
        tbl = Table(rows, colWidths=[15 * mm, 19 * mm, 14 * mm, 60 * mm, 62 * mm])
        tbl.setStyle(base_table_style())
        story.append(tbl)

    # --- Дифф ---
    diff = facts.get('diff')
    if diff:
        story.append(Paragraph('Изменения к предыдущей версии', h2))
        story.append(Paragraph(
            f"Добавлено: {diff['added_count']} · Удалено: {diff['removed_count']} · "
            f"Сдвигов сроков: {diff['shifted_count']} · "
            f"Изменений прогресса: {diff['progress_count']}", body))
        for line in (diff['shifted'][:10] + diff['added'][:5] + diff['removed'][:5]):
            story.append(Paragraph('• ' + _pdf_safe(_md_inline(line)), bullet))

    # --- Заключение аудитора (LLM) ---
    if llm_text:
        story.append(Paragraph('Заключение аудитора', h2))
        for line in llm_text.splitlines():
            s = line.strip()
            if not s:
                story.append(Spacer(1, 1.2 * mm))
            elif s.startswith('### '):
                story.append(Paragraph(_pdf_safe(_md_inline(s[4:])), h2))
            elif s.startswith('## '):
                story.append(Paragraph(_pdf_safe(_md_inline(s[3:])), h2))
            elif re.match(r'^(\d+[\.\)]\s|[-•]\s)', s):
                story.append(Paragraph('• ' + _pdf_safe(_md_inline(
                    re.sub(r'^(\d+[\.\)]\s|[-•]\s)', '', s))), bullet))
            else:
                story.append(Paragraph(_pdf_safe(_md_inline(s)), body))

    doc.build(story)
    return out_path
