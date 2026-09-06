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
from pdf import generate_pdf
from report import build_chat_summary

POLL_TIMEOUT = 30
MAX_FILE_MB = 20  # лимит getFile Bot API
TG_MSG_LIMIT = 4000  # лимит Telegram 4096, берём с запасом
ALLOWED_EXT = ('.xlsx', '.xls', '.csv', '.mpp')

HELP_TEXT = (
    '👋 Привет! Я аудирую проектные планы.\n\n'
    'Пришлите файл плана (.xlsx, .csv или .mpp) — проверю его '
    'по корпоративной Инструкции, найду риски и верну сводку и PDF-отчёт.\n\n'
    'Для .mpp предложу на выбор: аудит или конвертацию в Excel.\n'
    'Пришлите новую версию позже — покажу, что изменилось.'
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
        self.pending = {}  # chat_id → doc: .mpp ждёт выбора действия

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

        self.run_audit(chat_id, doc)

    def handle_callback(self, cq: dict):
        chat_id = (cq.get('message') or {}).get('chat', {}).get('id')
        action = cq.get('data')
        try:
            self.call('answerCallbackQuery', json={'id': cq['id']})
        except Exception:
            pass
        doc = self.pending.pop(chat_id, None)
        if not doc:
            self.send_text(chat_id, '⚠️ Файл не найден (бот перезапускался?) — '
                                    'пришлите его ещё раз')
            return
        if action == 'xlsx':
            self.convert_document(chat_id, doc)
        else:
            self.run_audit(chat_id, doc)

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

    def run_audit(self, chat_id: int, doc: dict):
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

            self.send_text(chat_id, '🤖 Метрики посчитаны, запускаю '
                                    'ИИ-анализ (обычно 1–3 минуты)…')
            llm_text = llm.analyze_plan(facts)

            self.send_text(chat_id, build_chat_summary(plan, facts))
            pdf_path = os.path.join(tmpdir, 'audit_report.pdf')
            generate_pdf(plan, facts, llm_text, pdf_path)
            self.send_doc(chat_id, pdf_path,
                          caption='Полный отчёт по аудиту плана')

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
                    if msg.get('document'):
                        self.handle_document(chat_id, msg['document'])
                    elif (msg.get('text') or '').startswith('/start') or \
                            (msg.get('text') or '').startswith('/help'):
                        self.send_text(chat_id, HELP_TEXT)
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
