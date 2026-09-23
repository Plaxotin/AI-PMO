#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PDF-отчёт BL-1 — «понять за 5 минут» (редизайн от 10.09.2026).

Структура (лучшие практики PMI / Asana, фидбек пользователя):
1. Шапка со статусом здоровья (RAG) — без служебных баллов;
2. «План в цифрах» — каждая метрика с пояснением, как её читать;
3. Заключение аудитора (LLM) — главная часть отчёта;
4. Приложение с детальными таблицами — для тех, кто хочет глубже.

Служебные коды правил (R-NN, D-NN) и упоминания корпоративной Инструкции
в отчёт не попадают — только суть проверок человеческим языком.
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
    'on_track': 'В ГРАФИКЕ',
    'at_risk': 'ЕСТЬ РИСК СРЫВА',
    'off_track': 'СРЫВ СРОКОВ',
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


def _metrics_rows(facts: dict) -> list:
    """«План в цифрах»: показатель → значение → как читать."""
    m = facts['metrics']
    total = max(1, m['tasks_total'])
    rows = [
        ('Всего задач', str(m['tasks_total']),
         f"в том числе этапов: {m['summaries']}, контрольных вех: {m['milestones']}"),
        ('Выполнено', f"{m['done']} ({round(100 * m['done'] / total)} %)",
         'задачи закрыты полностью'),
        ('В работе', f"{m['in_progress']} ({round(100 * m['in_progress'] / total)} %)",
         'начаты, но не завершены'),
        ('Не начато', f"{m['not_started']} ({round(100 * m['not_started'] / total)} %)",
         'работа ещё не начиналась'),
        ('Просрочено', f"{m['overdue']} ({round(100 * m['overdue'] / total)} %)",
         'срок вышел, а работа не завершена — требуют переноса или решения'),
        ('Критический путь', str(facts['cpm']['critical_count']),
         'задач без запаса по срокам: задержка любой из них сдвигает '
         'весь проект'),
    ]
    evm = facts.get('evm', {})
    if evm.get('available') and evm.get('spi') is not None:
        spi = evm['spi']
        if spi >= 0.95:
            verdict = 'проект поспевает за графиком'
        elif spi >= 0.8:
            verdict = 'умеренное отставание'
        else:
            verdict = f'отставание примерно в {round(1 / spi, 1)} раза'
        basis = ('оценка по длительностям задач — в плане нет затрат'
                 if evm.get('proxy') else 'веса по затратам')
        rows.append(('Темп выполнения (SPI)', str(spi),
                     f'работы выполняются на {round(spi * 100)} % от графика — '
                     f'{verdict} ({basis})'))
    # BEI выводится в таблице «Качество плана» следом за срывом базовых дат
    # (решение 13.09.26), поэтому в сводной таблице цифр не дублируется.
    return rows


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
    cell = ParagraphStyle('cell', parent=small)

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

    # --- 1. Шапка здоровья (RAG, Asana-style) ---
    status_label = STATUS_LABELS.get(status, health.get('label', '—'))
    rag = Table([[Paragraph(f"<font color='white'><b>{status_label}</b></font>",
                            body)]], colWidths=[180 * mm])
    rag.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), colors.Color(*sc)),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(rag)
    story.append(Spacer(1, 1.5 * mm))
    for reason in health.get('reasons', [])[:5]:
        story.append(Paragraph('• ' + _pdf_safe(_md_inline(reason)), bullet))

    # --- 2. План в цифрах (с пояснениями) ---
    story.append(Paragraph('План в цифрах', h2))
    rows = [['Показатель', 'Значение', 'Как читать']]
    for name, value, hint in _metrics_rows(facts):
        rows.append([Paragraph(_pdf_safe(_md_inline(name)), cell), value,
                     Paragraph(_pdf_safe(_md_inline(hint)), cell)])
    tbl = Table(rows, colWidths=[50 * mm, 25 * mm, 105 * mm])
    tbl.setStyle(base_table_style())
    story.append(tbl)

    # --- 3. Заключение аудитора (LLM) — главная часть ---
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

    # --- 4. Приложение: детали для проверки ---
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph('Приложение. Детализация проверок', h1))

    # 4.1 Качество плана (бывш. DCMA) — с легендой, как читать.
    # Проверки полноты модели (kind='model') сюда не входят — они выше
    # вынесены в рекомендации (решение 12.09.26). Показатели-метрики
    # (kind='metric', напр. BEI) не строка проверки — BEI идёт отдельной
    # строкой сразу после «Срыв базовых дат окончания» (13.09.26).
    from analytics import BEI_THRESHOLD
    sched = facts.get('schedule_health', {})
    bei = sched.get('bei')
    checks = [c for c in sched.get('checks', [])
              if c.get('kind') not in ('model', 'metric')]
    if checks:
        story.append(Paragraph('Качество плана', h2))
        story.append(Paragraph(
            'Каждая проверка оценивает долю задач с определённым дефектом. '
            'Норма: не более 5 % задач (если не указано иное). Строки, где '
            'норма нарушена, выделены красным. «н/д» — проверка неприменима '
            'к этому источнику (нужен исходный .mpp).', small))
        story.append(Spacer(1, 1.5 * mm))
        icon = {'pass': 'норма', 'fail': 'НАРУШЕНО', 'n/a': 'н/д'}
        family_names = {'structure': 'Логика сети', 'realism': 'Реалистичность',
                        'performance': 'Исполнение'}
        rows = [['Итог', 'Проверка', 'Группа', 'Нарушений', 'Доля']]
        row_colors = []
        for c in checks:
            rows.append([icon.get(c['status'], '?'), c['name'],
                         family_names.get(c['family'], c['family']),
                         str(c['count']) if c['status'] != 'n/a' else '—',
                         f"{c['percent']} %" if c['status'] != 'n/a' else 'н/д'])
            if c['status'] == 'fail':
                row_colors.append(len(rows) - 1)
            # BEI — следующим показателем после срыва базовых дат
            if c['id'] == 'D-11' and bei is not None:
                bei_ok = bei >= BEI_THRESHOLD
                rows.append(['норма' if bei_ok else 'НАРУШЕНО',
                             'Индекс выполнения базового плана (BEI)',
                             family_names['performance'], '—',
                             f'{bei} ({round(bei * 100)} %)'])
                if not bei_ok:
                    row_colors.append(len(rows) - 1)
        tbl = Table(rows, colWidths=[22 * mm, 62 * mm, 30 * mm, 22 * mm, 18 * mm],
                    repeatRows=1)
        style = [('TEXTCOLOR', (0, r), (0, r), colors.red)
                 for r in row_colors]
        tbl.setStyle(base_table_style(style))
        story.append(tbl)
        fails = [c for c in checks if c['status'] == 'fail']
        if fails:
            story.append(Spacer(1, 1.5 * mm))
            story.append(Paragraph('Примеры нарушений:', small))
            for c in fails[:4]:
                if c['evidence']:
                    story.append(Paragraph(
                        f"<b>{c['name']}</b>: "
                        f"{_pdf_safe(_md_inline('; '.join(c['evidence'][:3])))}",
                        small))

    # 4.2 Замечания по оформлению — суть без кодов (только finding)
    findings = [v for v in facts['compliance'] if v.get('kind') != 'model']
    if findings:
        story.append(Paragraph('Замечания по оформлению плана', h2))
        sev_names = {'high': 'критично', 'medium': 'важно', 'info': 'к сведению'}
        rows = [['Что не так', 'Важность', 'Кол-во', 'Примеры']]
        for v in findings:
            rows.append([Paragraph(_pdf_safe(_md_inline(
                             v.get('title', v['rule']))), cell),
                         sev_names.get(v['severity'], v['severity']),
                         str(v['count']),
                         Paragraph(_pdf_safe(_md_inline(
                             '; '.join(v['evidence'][:2]))), cell)])
        tbl = Table(rows, colWidths=[48 * mm, 20 * mm, 14 * mm, 98 * mm],
                    repeatRows=1)
        tbl.setStyle(base_table_style())
        story.append(tbl)

    # 4.3 Полнота модели → рекомендации (не замечания, решение 12.09.26)
    model = facts.get('model_completeness') or []
    if model:
        story.append(Paragraph(
            'Рекомендации по улучшению плана (не замечания)', h2))
        story.append(Paragraph(
            'Эти поля многие команды сознательно не ведут — это не ошибки '
            'исполнения. Но их заполнение повышает качество и плана, и аудита.',
            small))
        story.append(Spacer(1, 1.5 * mm))
        rows = [['Что заполнить', 'Масштаб', 'Зачем это нужно']]
        for r in model:
            scale = (f"{r['count']} шт. ({r['percent']} %)"
                     if r.get('percent') is not None else f"{r['count']} шт.")
            rows.append([Paragraph(_pdf_safe(_md_inline(r['topic'])), cell),
                         scale,
                         Paragraph(_pdf_safe(_md_inline(r['benefit'])), cell)])
        tbl = Table(rows, colWidths=[45 * mm, 28 * mm, 107 * mm], repeatRows=1)
        tbl.setStyle(base_table_style())
        story.append(tbl)

    # 4.3 Дифф к предыдущей версии
    diff = facts.get('diff')
    if diff:
        story.append(Paragraph('Изменения к предыдущей версии', h2))
        story.append(Paragraph(
            f"Добавлено задач: {diff['added_count']} · "
            f"Удалено: {diff['removed_count']} · "
            f"Сдвигов сроков: {diff['shifted_count']} · "
            f"Изменений прогресса: {diff['progress_count']}", body))
        for line in (diff['shifted'][:10] + diff['added'][:5]
                     + diff['removed'][:5]):
            story.append(Paragraph('• ' + _pdf_safe(_md_inline(line)), bullet))

    doc.build(story)
    return out_path


def generate_sponsor_pdf(plan_name: str, facts: dict, llm_text: str,
                         out_path: str) -> str:
    """Спонсорский отчёт (C-level) — 1 страница A4, 6 разделов (v1.1).

    Контент пишет LLM (sponsor-промпт в llm.py); здесь — рамка:
    цветной статус-баннер + компактная вёрстка без приложений.
    """
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                    Table, TableStyle)
    from reportlab.lib import colors

    font, font_bold = _register_fonts()
    h1 = ParagraphStyle('h1', fontName=font_bold, fontSize=14, spaceAfter=1 * mm)
    h2 = ParagraphStyle('h2', fontName=font_bold, fontSize=10.5,
                        spaceBefore=2.5 * mm, spaceAfter=1 * mm)
    body = ParagraphStyle('body', fontName=font, fontSize=9, leading=12)
    bullet = ParagraphStyle('bullet', parent=body, leftIndent=4 * mm,
                            bulletIndent=1 * mm)
    small = ParagraphStyle('small', fontName=font, fontSize=7.5, leading=9.5)

    health = facts.get('health', {})
    status = health.get('status', 'at_risk')
    sc = STATUS_COLORS.get(status, (0.5, 0.5, 0.5))

    doc = SimpleDocTemplate(out_path, pagesize=A4,
                            leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=12 * mm, bottomMargin=12 * mm)

    story = [Paragraph(f'Отчёт для спонсора · проект «{plan_name}»', h1),
             Paragraph(f"Дата: {facts['report_date']}", small),
             Spacer(1, 2 * mm)]

    status_label = STATUS_LABELS.get(status, '—')
    rag = Table([[Paragraph(f"<font color='white'><b>{status_label}</b></font>",
                            body)]], colWidths=[182 * mm])
    rag.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), colors.Color(*sc)),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(rag)

    if llm_text:
        for line in llm_text.splitlines():
            s = line.strip()
            if not s:
                story.append(Spacer(1, 0.8 * mm))
            elif s.startswith('### '):
                story.append(Paragraph(_pdf_safe(_md_inline(s[4:])), h2))
            elif s.startswith('## '):
                story.append(Paragraph(_pdf_safe(_md_inline(s[3:])), h2))
            elif re.match(r'^(\d+[\.\)]\s|[-•]\s)', s):
                story.append(Paragraph('• ' + _pdf_safe(_md_inline(
                    re.sub(r'^(\d+[\.\)]\s|[-•]\s)', '', s))), bullet))
            else:
                story.append(Paragraph(_pdf_safe(_md_inline(s)), body))

    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(
        'Подготовлено автоматическим аудитором проектных планов на основе '
        'детерминированного анализа расписания. Файл плана не сохраняется '
        'на сервере.', small))

    doc.build(story)
    return out_path


def generate_digest_pdf(plan_name: str, facts: dict, trend: dict,
                        bl6: Optional[dict], decisions: Optional[list],
                        out_path: str) -> str:
    """Спонсорский дайджест (v1.2) — 1 страница A4: статус-баннер, плитки
    KPI, динамика к прошлому аудиту, метрики поручений, 3 решения недели."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                    Table, TableStyle)
    from reportlab.lib import colors

    font, font_bold = _register_fonts()
    h1 = ParagraphStyle('h1', fontName=font_bold, fontSize=14, spaceAfter=1 * mm)
    h2 = ParagraphStyle('h2', fontName=font_bold, fontSize=10.5,
                        spaceBefore=2.5 * mm, spaceAfter=1 * mm)
    body = ParagraphStyle('body', fontName=font, fontSize=9, leading=12)
    bullet = ParagraphStyle('bullet', parent=body, leftIndent=4 * mm,
                            bulletIndent=1 * mm)
    small = ParagraphStyle('small', fontName=font, fontSize=7.5, leading=9.5)

    health = facts.get('health', {})
    m = facts.get('metrics', {})
    evm = facts.get('evm', {})
    sched = facts.get('schedule_health', {})
    status = health.get('status', 'at_risk')
    sc = STATUS_COLORS.get(status, (0.5, 0.5, 0.5))

    doc = SimpleDocTemplate(out_path, pagesize=A4,
                            leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=12 * mm, bottomMargin=12 * mm)

    story = [Paragraph(f'Дайджест для спонсора · проект «{plan_name}»', h1),
             Paragraph(f"Дата отчёта: {facts['report_date']}", small),
             Spacer(1, 2 * mm)]

    status_label = STATUS_LABELS.get(status, '—')
    rag = Table([[Paragraph(f"<font color='white'><b>{status_label}</b></font>",
                            body)]], colWidths=[182 * mm])
    rag.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), colors.Color(*sc)),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(rag)
    story.append(Spacer(1, 2 * mm))

    # --- Плитки KPI ---
    def pct(v):
        return f'{round(v * 100)} %' if v is not None else '—'

    overdue_pct = round(100.0 * m.get('overdue', 0) / max(1, m.get('tasks_total', 1)))
    done_pct = round(100.0 * m.get('done', 0) / max(1, m.get('tasks_total', 1)))
    tiles = [
        ('Темп выполнения', pct(evm.get('spi')) if evm.get('available') else '—',
         'доля запланированного объёма, которая фактически сделана'),
        ('Исполнение базы', pct(sched.get('bei')),
         'доля задач, которые по базовому плану должны быть готовы к сегодня'),
        ('Готовность', f'{done_pct} %', f"выполнено {m.get('done', '—')} из "
         f"{m.get('tasks_total', '—')} задач"),
        ('Просрочено', f"{m.get('overdue', '—')} шт.",
         f'{overdue_pct} % задач — срок вышел, работа не завершена'),
    ]
    cells = [[Paragraph(f'<b>{t}</b>', small) for t, _, _ in tiles],
             [Paragraph(v, ParagraphStyle('v', fontName=font_bold,
                                          fontSize=13, leading=15))
              for _, v, _ in tiles],
             [Paragraph(d, small) for _, _, d in tiles]]
    tbl = Table(cells, colWidths=[45.5 * mm] * 4)
    tbl.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, colors.Color(0.8, 0.8, 0.8)),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.Color(0.85, 0.85, 0.85)),
        ('BACKGROUND', (0, 0), (-1, 0), colors.Color(0.94, 0.94, 0.94)),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(tbl)

    # --- Динамика ---
    if trend and trend.get('available'):
        story.append(Paragraph(f"Динамика с {trend['prev_date']}", h2))
        for ln in trend.get('lines', []):
            story.append(Paragraph('• ' + _pdf_safe(ln), bullet))
        if trend.get('status_changed'):
            story.append(Paragraph('• изменился общий статус проекта', bullet))

    # --- Поручения ---
    if bl6 and bl6.get('available'):
        pct_txt = (f"{bl6['done_on_time_pct']} % закрыты в срок"
                   if bl6.get('done_on_time_pct') is not None
                   else 'доля в срок не считается (нет дат закрытия)')
        story.append(Paragraph(_md_inline(
            f"Поручения (реестр МТИ&PSI, на {bl6['as_of']})"), h2))
        story.append(Paragraph(_pdf_safe(
            f"открыто {bl6['open']} из {bl6['total']} · выполнено {bl6['done']} · "
            f"отменено {bl6['canceled']} · {pct_txt} · просрочено открытых: "
            f"{bl6['open_overdue']}"), body))

    # --- 3 решения недели ---
    if decisions:
        story.append(Paragraph('3 решения на этой неделе', h2))
        for i, d in enumerate(decisions[:3], 1):
            story.append(Paragraph(
                _pdf_safe(_md_inline(f"{i}. **{d['title']}**")), bullet))
            if d.get('why'):
                story.append(Paragraph(_pdf_safe(_md_inline(d['why'])), bullet))
            if d.get('decision'):
                story.append(Paragraph(
                    _pdf_safe(_md_inline('👉 ' + d['decision'])), bullet))
            story.append(Spacer(1, 0.8 * mm))

    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(
        'Подготовлено автоматически на основе детерминированного анализа '
        'расписания и реестра поручений. Файл плана не сохраняется на сервере.',
        small))

    doc.build(story)
    return out_path
