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
from config import load_telegram_config
from pdf import generate_pdf
from report import build_chat_summary

POLL_TIMEOUT = 30
MAX_FILE_MB = 50
ALLOWED_EXT = ('.xlsx', '.xls', '.csv', '.mpp')

HELP_TEXT = (
    '👋 Привет! Я аудитую проектные планы.\n\n'
    'Просто пришлите файл плана (.xlsx, .csv или .mpp) — я проверю его '
    'по корпоративной Инструкции, найду риски и верну сводку и PDF-отчёт.\n\n'
    'Пришлите новую версию позже — покажу, что изменилось.'
)


class Bot:
    def __init__(self, token: str):
        self.token = token
        self.api = f'https://api.telegram.org/bot{token}'
        self.offset = 0

    # --- Telegram API ---
    def call(self, method: str, **kwargs):
        resp = requests.post(f'{self.api}/{method}', timeout=POLL_TIMEOUT + 10,
                             **kwargs)
        return resp.json()

    def send_text(self, chat_id: int, text: str):
        self.call('sendMessage', json={'chat_id': chat_id, 'text': text,
                                       'parse_mode': 'Markdown'})

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

            self.send_action(chat_id)  # LLM думает долго — держим «печатает…»
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
