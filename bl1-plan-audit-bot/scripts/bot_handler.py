#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Telegram-бот BL-1 «Аудит проектного плана» — polling-цикл.

Пайплайн на документ:
  скачать файл → parse_plan → run_analysis (+ дифф с предыдущим из state)
  → llm.analyze_plan → сводка в чат (report) + PDF (pdf.generate_pdf)
  → удалить файл с диска (stateless), запомнить file_id в state.

Команды: /start, /help. Остальное — просто прислать файл.
Конфиг: .credentials/telegram.json, .credentials/kimi.json
"""

import os
import tempfile
import time

import requests

import analytics
import llm
import plan_parser
import state
import xlsx_export
from config import load_telegram_config
from pdf import generate_pdf, generate_sponsor_pdf
from report import build_chat_summary, build_detail

POLL_TIMEOUT = 30
MAX_FILE_MB = 20  # лимит getFile Bot API
TG_MSG_LIMIT = 4000  # лимит Telegram 4096, берём с запасом
ALLOWED_EXT = ('.xlsx', '.xls', '.csv', '.mpp')

HELP_TEXT = (
    '👋 Привет! Я аудирую проектные планы.\n\n'
    'Пришлите файл плана (.xlsx, .csv или .mpp) — найду риски, проверю '
    'исполнение и верну сводку и PDF-отчёт.\n\n'
    'Перед аудитом можно одним сообщением указать акценты — '
    'отвечу на них в отчёте.\n'
    'Для .mpp предложу на выбор: аудит или конвертацию в Excel.\n'
    'После аудита доступен отдельный отчёт для спонсора (C-level).\n'
    'Пришлите новую версию позже — покажу, что изменилось.'
)

COMMENT_OFFER = (
    '💬 Есть акценты для аудитора? Напишите одним сообщением, что для вас '
    'сейчас важнее всего в плане — учту в аудите и отвечу отдельным разделом '
    'отчёта. Или начните аудит сразу:'
)

SPONSOR_CONTEXT_OFFER = (
    '📄 Отчёт для спонсора. Чтобы связать выводы с бизнесом, напишите одним '
    'сообщением: цель проекта для компании, критерии успеха, что важнее — '
    'срок или содержание, какие решения ждёте от спонсора.\n'
    'Или сформируйте отчёт только по данным плана:'
)


def _split_text(text: str, limit: int) -> list:
    """Режет длинный текст на куски ≤limit, предпочитая границы строк."""
    if len(text) <= limit:
        return [text]
    chunks, cur = [], ''
    for line in text.split('\n'):
        if cur and len(cur) + len(line) + 1 > limit:
            chunks.append(cur)
            cur = ''
        while len(line) > limit:
            chunks.append(line[:limit])
            line = line[limit:]
        cur = f'{cur}\n{line}' if cur else line
    if cur:
        chunks.append(cur)
    return chunks


class Bot:
    def __init__(self, token: str):
        self.token = token
        self.api = f'https://api.telegram.org/bot{token}'
        self.offset = 0
        self.pending = {}   # chat_id → doc: .mpp ждёт выбора действия
        # chat_id → {'purpose': 'audit'|'sponsor', 'doc': doc}
        # ждём текст-комментарий от пользователя (или кнопку «Пропустить»)
        self.awaiting = {}
        # chat_id → {'plan_name', 'facts'} последнего аудита (в памяти,
        # stateless: после перезапуска бота отчёт для спонсора попросит файл заново)
        self.last_run = {}

    # --- Telegram API ---
    def call(self, method: str, **kwargs):
        resp = requests.post(f'{self.api}/{method}', timeout=POLL_TIMEOUT + 10,
                             **kwargs)
        return resp.json()

    def send_text(self, chat_id: int, text: str):
        """Отправляет текст кусками ≤4000 символов.

        Если Markdown ломается о спецсимволы (имена задач с _ * ` [ ]),
        повторяет кусок как plain text. Ошибки логирует, не глотает.
        """
        for chunk in _split_text(text, TG_MSG_LIMIT):
            res = self.call('sendMessage', json={'chat_id': chat_id,
                                                 'text': chunk,
                                                 'parse_mode': 'Markdown'})
            if not res.get('ok'):
                res = self.call('sendMessage',
                                json={'chat_id': chat_id, 'text': chunk})
            if not res.get('ok'):
                print(f'⚠️ sendMessage не доставлено: {res}')

    def send_doc(self, chat_id: int, path: str, caption: str = ''):
        with open(path, 'rb') as f:
            self.call('sendDocument',
                      data={'chat_id': chat_id, 'caption': caption},
                      files={'document': (os.path.basename(path), f)})

    def send_action(self, chat_id: int, action: str = 'typing'):
        try:
            self.call('sendChatAction', json={'chat_id': chat_id,
                                              'action': action})
        except Exception:
            pass

    def download(self, file_id: str, dest: str) -> str:
        info = self.call('getFile', json={'file_id': file_id})
        file_path = info['result']['file_path']
        url = f'https://api.telegram.org/file/bot{self.token}/{file_path}'
        with requests.get(url, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(dest, 'wb') as f:
                for chunk in r.iter_content(1 << 16):
                    f.write(chunk)
        return dest

    # --- Пайплайн аудита ---
    def handle_document(self, chat_id: int, doc: dict):
        file_name = doc.get('file_name', 'plan')
        ext = os.path.splitext(file_name)[1].lower()
        if ext not in ALLOWED_EXT:
            self.send_text(chat_id, '⚠️ Пришлите файл .xlsx, .csv или .mpp')
            return
        if doc.get('file_size', 0) > MAX_FILE_MB * 1024 * 1024:
            self.send_text(chat_id, f'⚠️ Файл больше {MAX_FILE_MB} МБ не принимаю')
            return

        # .mpp — на выбор: аудит или конвертация в Excel
        if ext == '.mpp':
            self.pending[chat_id] = doc
            self.call('sendMessage', json={
                'chat_id': chat_id,
                'text': f'📥 Принял «{file_name}». Что сделать с файлом?',
                'reply_markup': {'inline_keyboard': [[
                    {'text': '🔍 Аудит плана', 'callback_data': 'audit'},
                    {'text': '📊 Конвертировать в Excel',
                     'callback_data': 'xlsx'},
                ]]},
            })
            return

        self.offer_comment(chat_id, doc)

    def offer_comment(self, chat_id: int, doc: dict):
        """Мягкий шаг (v1.1): комментарий аудитору в свободной форме или скип."""
        self.awaiting[chat_id] = {'purpose': 'audit', 'doc': doc}
        self.call('sendMessage', json={
            'chat_id': chat_id,
            'text': COMMENT_OFFER,
            'reply_markup': {'inline_keyboard': [[
                {'text': '⏩ Пропустить — начать аудит',
                 'callback_data': 'skip'}]]},
        })

    def _offer(self, chat_id: int, action: str, text: str):
        """Одна follow-up кнопка: «Что дальше?»."""
        self.call('sendMessage', json={
            'chat_id': chat_id,
            'text': 'Что дальше?',
            'reply_markup': {'inline_keyboard': [[
                {'text': text, 'callback_data': action}]]},
        })

    def handle_callback(self, cq: dict):
        msg = cq.get('message') or {}
        chat_id = msg.get('chat', {}).get('id')
        action = cq.get('data')
        try:
            self.call('answerCallbackQuery', json={'id': cq['id']})
            # Убираем нажатую клавиатуру — защита от повторных запусков.
            # ИСКЛЮЧЕНИЕ (13.09.26): кнопки детализации det_* должны
            # нажиматься по очереди — клавиатуру оставляем.
            if msg.get('message_id') and not (action or '').startswith('det_'):
                self.call('editMessageReplyMarkup', json={
                    'chat_id': chat_id, 'message_id': msg['message_id'],
                    'reply_markup': {'inline_keyboard': []}})
        except Exception:
            pass

        # Кнопка «Пропустить» на шаге комментария / контекста спонсора
        if action == 'skip':
            wait = self.awaiting.pop(chat_id, None)
            if not wait:
                self.send_text(chat_id, '⚠️ Сессия устарела — пришлите файл '
                                        'плана ещё раз')
            elif wait['purpose'] == 'audit':
                self.run_audit(chat_id, wait['doc'])
            else:
                self.run_sponsor(chat_id, context=None)
            return

        if action == 'sponsor':
            self.start_sponsor_flow(chat_id)
            return

        # Drill-down по направлениям отчёта (v1.1): качество/замечания/рекомендации
        if action and action.startswith('det_'):
            self.send_detail(chat_id, action[4:])
            return

        doc = self.pending.get(chat_id)  # не pop: после конвертации может идти аудит
        if not doc:
            self.send_text(chat_id, '⚠️ Файл не найден (бот перезапускался?) — '
                                    'пришлите его ещё раз')
            return
        if action == 'xlsx':
            self.convert_document(chat_id, doc)
        else:  # audit
            self.offer_comment(chat_id, doc)

    def convert_document(self, chat_id: int, doc: dict):
        """Конвертация .mpp → .xlsx и отправка результата."""
        file_name = doc.get('file_name', 'plan.mpp')
        self.send_text(chat_id, f'📊 Конвертирую «{file_name}» в Excel…')
        tmpdir = tempfile.mkdtemp(prefix='bl1conv_')
        local_path = os.path.join(tmpdir, file_name)
        xlsx_path = None
        try:
            self.download(doc['file_id'], local_path)
            plan = plan_parser.parse_mpp(local_path, file_name)
            xlsx_path = os.path.join(
                tmpdir, os.path.splitext(file_name)[0] + '.xlsx')
            xlsx_export.plan_to_xlsx(plan, xlsx_path)
            self.send_doc(chat_id, xlsx_path,
                          caption=f'Готово: {len(plan.tasks)} задач '
                                  f'({len(plan.leaves())} работ, '
                                  f'{len(plan.summaries())} сводок, '
                                  f'{len(plan.milestones())} вех)')
            self._offer(chat_id, 'audit', '🔍 Начать аудит плана')
        except Exception as e:
            print(f'❌ ошибка конвертации: {e}')
            self.send_text(chat_id, f'❌ Не получилось: {e}')
        finally:
            for p in (local_path, xlsx_path):
                try:
                    if p and os.path.exists(p):
                        os.unlink(p)
                except Exception:
                    pass

    def run_audit(self, chat_id: int, doc: dict, comment: str = None):
        file_name = doc.get('file_name', 'plan')
        self.send_text(chat_id, f'📥 Принял «{file_name}», начинаю аудит…')
        tmpdir = tempfile.mkdtemp(prefix='bl1_')
        local_path = os.path.join(tmpdir, file_name)
        pdf_path = None
        try:
            self.download(doc['file_id'], local_path)

            self.send_action(chat_id)
            plan = plan_parser.parse_plan(local_path, file_name)

            # Дифф с предыдущей версией из истории чата (метаданные в state)
            baseline_plan = None
            prev = state.previous_plan(chat_id) or state.last_plan(chat_id)
            if prev and prev.get('file_id') != doc['file_id']:
                try:
                    prev_path = os.path.join(tmpdir, 'prev_' + prev['file_name'])
                    self.download(prev['file_id'], prev_path)
                    baseline_plan = plan_parser.parse_plan(
                        prev_path, prev['file_name'])
                except Exception as e:
                    print(f'⚠️ не удалось загрузить предыдущую версию: {e}')

            facts = analytics.run_analysis(plan, baseline_plan=baseline_plan)
            # Кэш для drill-down и отчёта спонсору: память + диск
            self.last_run[chat_id] = {'plan_name': plan.name, 'facts': facts}
            state.save_last_run(chat_id, plan.name, facts)

            self.send_text(chat_id, '🤖 Метрики посчитаны, запускаю '
                                    'ИИ-анализ (обычно 1–3 минуты)…')
            llm_text = llm.analyze_plan(facts, user_comment=comment)

            self.send_text(chat_id, build_chat_summary(plan, facts))
            pdf_path = os.path.join(tmpdir, 'audit_report.pdf')
            generate_pdf(plan, facts, llm_text, pdf_path)
            self.send_doc(chat_id, pdf_path,
                          caption='Полный отчёт по аудиту плана')

            buttons = [{'text': '📄 Отчёт для спонсора',
                        'callback_data': 'sponsor'}]
            if file_name.lower().endswith('.mpp'):
                buttons.append({'text': '📊 Конвертировать в Excel',
                                'callback_data': 'xlsx'})
            detail_row = [
                {'text': '🔧 Улучшить качество', 'callback_data': 'det_quality'},
                {'text': '🛠 Устранить замечания', 'callback_data': 'det_findings'},
                {'text': '💡 Учесть рекомендации', 'callback_data': 'det_reco'},
            ]
            self.call('sendMessage', json={
                'chat_id': chat_id,
                'text': 'Что дальше? Кнопки ниже дают детальные списки задач '
                        'с инструкциями по исправлению:',
                'reply_markup': {'inline_keyboard': [detail_row, buttons]}})

            state.remember_plan(chat_id, doc['file_id'], file_name)
        except Exception as e:
            print(f'❌ ошибка аудита: {e}')
            self.send_text(chat_id, f'❌ Не получилось: {e}')
        finally:
            # Stateless: файлы плана не храним на сервере
            for p in (local_path, pdf_path):
                try:
                    if p and os.path.exists(p):
                        os.unlink(p)
                except Exception:
                    pass

    # --- Кэш последнего аудита: память + диск (переживает рестарт) ---
    def _cached_run(self, chat_id: int):
        cached = self.last_run.get(chat_id)
        if not cached:
            cached = state.load_last_run(chat_id)
            if cached:
                self.last_run[chat_id] = cached
        return cached

    # --- Drill-down по направлениям отчёта (v1.1) ---
    def send_detail(self, chat_id: int, direction: str):
        cached = self._cached_run(chat_id)
        if not cached:
            self.send_text(chat_id,
                           '⚠️ Нет данных аудита (бот перезапускался?) — '
                           'пришлите файл плана и прогоните аудит заново')
            return
        try:
            text = build_detail(cached['facts'], direction)
        except Exception as e:
            print(f'❌ ошибка детализации {direction}: {e}')
            self.send_text(chat_id, f'❌ Не получилось собрать сводку: {e}')
            return
        if len(text) <= TG_MSG_LIMIT:
            self.send_text(chat_id, text)
            return
        # Длинная сводка — файлом .txt (читается прямо в Telegram)
        tmpdir = tempfile.mkdtemp(prefix='bl1det_')
        path = os.path.join(tmpdir, f'detail_{direction}.txt')
        try:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(text.replace('*', ''))  # без markdown-разметки в файле
            self.send_doc(chat_id, path,
                          caption='Полная детализация — список задач')
        finally:
            try:
                if os.path.exists(path):
                    os.unlink(path)
            except Exception:
                pass

    # --- Отчёт для спонсора (v1.1) ---
    def start_sponsor_flow(self, chat_id: int):
        if not self._cached_run(chat_id):
            self.send_text(chat_id,
                           '⚠️ Нет данных аудита (бот перезапускался?) — '
                           'пришлите файл плана и прогоните аудит заново')
            return
        self.awaiting[chat_id] = {'purpose': 'sponsor', 'doc': None}
        self.call('sendMessage', json={
            'chat_id': chat_id,
            'text': SPONSOR_CONTEXT_OFFER,
            'reply_markup': {'inline_keyboard': [[
                {'text': '⏩ Пропустить — сформировать отчёт',
                 'callback_data': 'skip'}]]},
        })

    def run_sponsor(self, chat_id: int, context: str = None):
        cached = self._cached_run(chat_id)
        if not cached:
            self.send_text(chat_id,
                           '⚠️ Нет данных аудита — пришлите файл плана '
                           'и прогоните аудит заново')
            return
        self.send_text(chat_id, '🤖 Формирую отчёт для спонсора '
                                '(обычно 1–2 минуты)…')
        tmpdir = tempfile.mkdtemp(prefix='bl1sponsor_')
        pdf_path = os.path.join(tmpdir, 'sponsor_report.pdf')
        try:
            text = llm.sponsor_report(cached['facts'], context=context)
            if not text:
                self.send_text(chat_id, '❌ ИИ-анализ недоступен, попробуйте '
                                        'позже')
                return
            generate_sponsor_pdf(cached['plan_name'], cached['facts'], text,
                                 pdf_path)
            self.send_doc(chat_id, pdf_path,
                          caption='Отчёт для спонсора (1 страница)')
        except Exception as e:
            print(f'❌ ошибка спонсорского отчёта: {e}')
            self.send_text(chat_id, f'❌ Не получилось: {e}')
        finally:
            try:
                if os.path.exists(pdf_path):
                    os.unlink(pdf_path)
            except Exception:
                pass

    # --- Цикл ---
    def run(self):
        print('BL-1 plan-audit bot started')
        while True:
            try:
                data = self.call('getUpdates', json={
                    'offset': self.offset, 'timeout': POLL_TIMEOUT})
                for upd in data.get('result', []):
                    self.offset = upd['update_id'] + 1
                    if upd.get('callback_query'):
                        self.handle_callback(upd['callback_query'])
                        continue
                    msg = upd.get('message') or {}
                    chat_id = (msg.get('chat') or {}).get('id')
                    if not chat_id:
                        continue
                    text = msg.get('text') or ''
                    if msg.get('document'):
                        # новый файл отменяет ожидание комментария
                        self.awaiting.pop(chat_id, None)
                        self.handle_document(chat_id, msg['document'])
                    elif text.startswith('/start') or text.startswith('/help'):
                        self.send_text(chat_id, HELP_TEXT)
                    elif text.startswith('/sponsor'):
                        self.start_sponsor_flow(chat_id)
                    elif text and chat_id in self.awaiting:
                        # ответ на шаг комментария / контекста спонсора
                        wait = self.awaiting.pop(chat_id)
                        if wait['purpose'] == 'audit':
                            self.run_audit(chat_id, wait['doc'], comment=text)
                        else:
                            self.run_sponsor(chat_id, context=text)
            except Exception as e:
                print(f'⚠️ polling error: {e}')
                time.sleep(5)


def main():
    cfg = load_telegram_config()
    if not cfg:
        raise SystemExit('Нет .credentials/telegram.json (bot_token)')
    Bot(cfg['bot_token']).run()


if __name__ == '__main__':
    main()
