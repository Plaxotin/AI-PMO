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
from typing import Optional

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
    """BEI строкой с расшифровкой словами (аббревиатура в скобках).

    Выводится следом за «Срыв базовых дат окончания» — единое замечание
    об исполнении базового плана (решение 13.09.26).
    """
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
    return (f"📌 Индекс выполнения базового плана (BEI) = {bei} — из задач, "
            f"которые по базовому плану должны быть завершены к сегодня, "
            f"выполнено {round(bei * 100)} %{detail}")


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
    lines.append('')

    fails = [c for c in sched.get('checks', [])
             if c['status'] == 'fail' and c.get('kind') not in ('model', 'metric')]
    if fails:
        lines.append('*Качество плана — что не так* '
                     '(норма: проблем ≤ 5 % задач):')
        bei_shown = False
        for c in fails[:6]:
            lines.append(f"❌ {c['name']} — {c['count']} шт. ({c['percent']} %)")
            # BEI — следующим показателем после срыва базовых дат (13.09.26)
            if c['id'] == 'D-11':
                line = _bei_line(sched)
                if line:
                    lines.append(line)
                    bei_shown = True
        if not bei_shown:
            line = _bei_line(sched)
            if line:
                lines.append(line)
        lines.append('')

    findings = [v for v in facts['compliance'] if v.get('kind') != 'model']
    if findings:
        lines.append('*Замечания по оформлению плана:*')
        for v in findings[:8]:
            icon = SEVERITY_ICON.get(v['severity'], '•')
            lines.append(f"{icon} {v.get('title', v['rule'])} — {v['count']} шт.")
        lines.append('')

    model = facts.get('model_completeness') or []
    if model:
        lines.append('*Рекомендации — сделают план и аудит лучше:*')
        for r in model[:5]:
            scale = (f" — {r['count']} шт. ({r['percent']} %)" if r.get('percent')
                     is not None else f" — {r['count']} шт.")
            lines.append(f"💡 {r['topic']}{scale}")
            lines.append(f"   {r['benefit'].capitalize()}")
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


# ---------- Drill-down: детальные сводки по направлениям (v1.1) ----------

DETAIL_TITLES = {
    'quality': 'Качество плана — детализация нарушений',
    'findings': 'Замечания по оформлению — детализация',
    'reco': 'Рекомендации по улучшению плана — детализация',
}

# «Как исправить» для каждой проверки/правила (13.09.26): сводка должна
# давать достаточно деталей, чтобы сразу приступить к правкам в MS Project
# или Excel.
HOWTO = {
    # --- проверки качества (D-NN) ---
    'D-02': 'Замените отрицательный лаг на явную декомпозицию: разбейте '
            'задачи так, чтобы работы шли последовательно без «наклёстов».',
    'D-03': 'Замените лаг на явную задачу-ожидание (например, «согласование») '
            '— тогда задержка видна в плане и ей можно управлять.',
    'D-04': 'Переведите связи типа SS/FF в Finish-to-Start: CPM корректно '
            'считает резервы только по цепочкам «окончание → начало».',
    'D-05': 'Уберите жёсткие ограничения (Must Start/Finish On) и замените '
            'их на вехи с крайним сроком (Deadline) — ограничения отключают '
            'автоматический пересчёт сети.',
    'D-07': 'Отрицательный резерв: задача физически не успевает к требуемой '
            'дате. Сдвиньте её раньше, добавьте ресурсы или пересмотрите '
            'ограничение.',
    'D-08': 'Декомпозируйте задачу на подзадачи до ~30 рабочих дней '
            '(1–1,5 месяца). Длинная задача не контролируется: промежуточный '
            'прогресс проверить невозможно, отставание видно слишком поздно.',
    'D-09': 'Для каждой задачи из списка: если работа фактически сделана — '
            'проставьте 100 % и фактическую дату; если нет — перенесите '
            'окончание на реалистичную дату в будущем.',
    'D-11': 'Пройдитесь по списку: либо догоняем базовую дату (ресурсы, '
            'сокращение объёма), либо оформляем изменение базового плана '
            'с фиксацией причины.',
    'D-15': 'Проставьте задаче даты начала и окончания: запланируйте работу '
            'или удалите/закройте её. Без дат задача не участвует в расчёте '
            'сроков и критического пути.',
    # --- правила оформления (R-NN) ---
    'R-02': 'Уберите связи с суммарных задач (этапов) и проставьте их между '
            'листовыми работами внутри этапов.',
    'R-03': 'Проверьте: задача отмечена выполненной, но дата окончания в '
            'будущем — исправьте % завершения или дату.',
    'R-04': 'Для каждой вехи из списка установите длительность 0 и крайний '
            'срок (Deadline) — иначе контрольная точка не работает.',
    'R-05': 'Создайте отдельный этап «Ключевые вехи» и перенесите туда '
            'контрольные точки — руководство следит именно за ними.',
    'R-07': 'Сохраните базовый план для всего проекта (в MS Project: '
            '«Задать базовый план»), затем убедитесь, что у задач из списка '
            'появились базовые сроки.',
    'R-09': 'Перенесите каждую незавершённую задачу из списка на '
            'реалистичную дату в будущем или закройте её (100 %).',
    'R-10': 'Задача должна была начаться, но не начата: сдвиньте начало на '
            'реальную дату и пересчитайте зависимые задачи.',
    'R-11': 'Отклонение > 30 дней от базы: оформите пересмотр базового плана '
            '(перебейзлайньте с фиксацией причины и даты изменения).',
    'R-12': 'Зафиксируйте отклонение от базовой даты: либо верните срок, '
            'либо обновите базовый план через процедуру изменений.',
    # --- полнота модели (рекомендации) ---
    'R-01': 'Откройте каждую задачу из списка и проставьте предшественника '
            '(что должно завершиться до неё) и/или последователя — задачу-'
            'потребителя результата (что зависит от неё). Тип связи — '
            '«окончание-начало» (FS). Без связи с потребителем задача '
            'получает искусственно большой резерв и искажает критический путь.',
    'D-01': 'Откройте каждую задачу из списка и проставьте предшественника '
            '(что должно завершиться до неё) и/или последователя — задачу-'
            'потребителя результата (что зависит от неё). Тип связи — '
            '«окончание-начало» (FS). Без связи с потребителем задача '
            'получает искусственно большой резерв и искажает критический путь.',
    'D-10': 'Заполните колонку «Ответственный» для каждой задачи из списка '
            '(ФИО или роль). Можно пакетно: отфильтруйте по этапу и '
            'проставьте владельца этапа.',
    'R-06': 'Проставьте каждой задаче из списка вес (колонка «Затраты») '
            'так, чтобы сумма весов всех листовых задач равнялась 100. '
            'Вес = трудоёмкость задачи относительно всего проекта.',
    'R-08': 'Добавьте в представление плана недостающие колонки из списка '
            'ниже — это типовой набор для контроля.',
}


def _items_of(entry: dict) -> list:
    """Полный список задач находки (или усечённые примеры как запасной вариант)."""
    return entry.get('items') or entry.get('evidence') or []


def _detail_section(lines: list, icon: str, title: str, count,
                    items: list, note: str = None, howto: str = None):
    suffix = f' — {count} шт.' if count is not None else ''
    lines.append(f'{icon} *{title}*{suffix}')
    if note:
        lines.append(f'_{note}_')
    if howto:
        lines.append(f'🔧 Как исправить: {howto}')
    if items:
        lines.append('Задачи:')
        for i, name in enumerate(items, 1):
            lines.append(f'{i}. {name}')
    lines.append('')


def build_detail(facts: dict, direction: str) -> str:
    """Полные списки задач по направлению: quality / findings / reco.

    Источник — полные списки 'items' в facts (в LLM не уходят).
    Текст может быть длинным — отправка через bot (чат или .txt-файл).
    """
    lines = [f"📋 *{DETAIL_TITLES[direction]}*", '']

    if direction == 'quality':
        sched = facts.get('schedule_health', {})
        rows = [c for c in sched.get('checks', [])
                if c.get('kind') not in ('model', 'metric')
                and c['status'] == 'fail']
        if not rows:
            lines.append('Нарушений норм качества не выявлено ✅')
        for c in rows:
            note = f"доля: {c['percent']} % (норма ≤ 5 %)"
            # BEI — пояснением к срыву базовых дат (13.09.26)
            if c['id'] == 'D-11':
                bei = sched.get('bei')
                if bei is not None:
                    note += (f" · индекс выполнения базового плана (BEI) = "
                             f"{bei} — выполнено {round(bei * 100)} % "
                             f"запланированного к сегодня")
            _detail_section(lines, '❌', c['name'], c['count'],
                            _items_of(c), note=note, howto=HOWTO.get(c['id']))

    elif direction == 'findings':
        rows = [v for v in facts.get('compliance', [])
                if v.get('kind') != 'model']
        if not rows:
            lines.append('Замечаний нет ✅')
        for v in rows:
            icon = SEVERITY_ICON.get(v['severity'], '•')
            _detail_section(lines, icon, v.get('title', v['rule']),
                            v['count'], _items_of(v),
                            howto=HOWTO.get(v['rule']))

    elif direction == 'reco':
        from analytics import MODEL_BENEFITS
        seen = set()
        rows = []
        for v in facts.get('compliance', []):
            if v.get('kind') == 'model':
                rows.append((v.get('title', v['rule']), v['count'], None,
                             _items_of(v), MODEL_BENEFITS.get(v['rule'], ''),
                             HOWTO.get(v['rule'])))
        for c in facts.get('schedule_health', {}).get('checks', []):
            if c.get('kind') == 'model' and c['status'] == 'fail':
                rows.append((c['name'], c['count'], c['percent'],
                             _items_of(c), MODEL_BENEFITS.get(c['id'], ''),
                             HOWTO.get(c['id'])))
        for title, count, pct, items, benefit, howto in rows:
            if benefit in seen:
                continue
            seen.add(benefit)
            scale = f'{count} шт.' + (f' ({pct} %)' if pct is not None else '')
            _detail_section(lines, '💡', f'{title} — {scale}', None,
                            items, note=benefit, howto=howto)
        if not rows:
            lines.append('План заполнен полностью, рекомендаций нет ✅')

    return '\n'.join(lines).strip()


# ---------- Спонсорский дайджест (v1.2) ----------

def build_sponsor_digest(plan_name: str, facts: dict, trend: dict,
                         bl6: Optional[dict], decisions: Optional[list]) -> str:
    """Дайджест здоровья проекта для C-level: статус, динамика, поручения,
    3 решения недели. Компактно — под лимит сообщения TG."""
    m = facts['metrics']
    health = facts.get('health', {})
    evm = facts.get('evm', {})

    lines = [
        f"📊 *Дайджест для спонсора · «{plan_name}»*",
        f"*{health.get('label', '—')}* · дата отчёта: {facts['report_date']}",
        '',
    ]
    for reason in health.get('reasons', [])[:2]:
        lines.append(f'• {reason}')
    lines.append('')

    # Динамика vs прошлый аудит
    if trend and trend.get('available'):
        lines.append(f"*Динамика с {trend['prev_date']}:*")
        for ln in trend.get('lines', []):
            lines.append(f'• {ln}')
        if trend.get('status_changed'):
            lines.append('• изменился общий статус проекта')
        lines.append('')
    else:
        lines.append('_Динамика: предыдущего аудита нет — сравнивать не с чем._')
        lines.append('')

    # Поручения (BL-6)
    if bl6 and bl6.get('available'):
        pct = bl6.get('done_on_time_pct')
        pct_txt = (f"{pct} % закрыты в срок" if pct is not None
                   else 'доля в срок не считается (нет дат закрытия)')
        lines.append(f"*Поручения (реестр МТИ&PSI на {bl6['as_of']}):* "
                     f"открыто {bl6['open']} из {bl6['total']}, "
                     f"{pct_txt}, просрочено открытых: {bl6['open_overdue']}")
        lines.append('')

    # 3 решения недели
    if decisions:
        lines.append('*3 решения на этой неделе:*')
        for i, d in enumerate(decisions[:3], 1):
            lines.append(f"{i}. *{d['title']}*")
            lines.append(f"   {d.get('why', '')}")
            lines.append(f"   👉 {d.get('decision', '')}")
        lines.append('')
    else:
        lines.append('_Решения недели не сформированы (ИИ-анализ недоступен)._')
        lines.append('')

    if evm.get('available'):
        line = _spi_line(evm)
        if line:
            lines.append(line)
    overdue_pct = round(100.0 * m['overdue'] / max(1, m['tasks_total']))
    lines.append(f"⏰ Просрочено: {m['overdue']} из {m['tasks_total']} "
                 f"({overdue_pct} %)")
    lines.append('')
    lines.append('Детали — в PDF ниже ⬇️ Детальные списки задач — '
                 'кнопками 🔧 Качество / 🛠 Замечания / 💡 Рекомендации выше.')

    text = '\n'.join(lines)
    return text[:TG_LIMIT - 1] + '…' if len(text) > TG_LIMIT else text
