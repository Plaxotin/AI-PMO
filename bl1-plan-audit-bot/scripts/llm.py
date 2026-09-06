#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LLM-контур BL-1 (Kimi k2.6) — по образцу BL-6, но thinking ВКЛЮЧЁН.

Качество результата важнее времени и стоимости: большой max_tokens,
длинный таймаут, retry с backoff.

LLM получает ТОЛЬКО факты детерминированного анализа (analytics.run_analysis)
и интерпретирует их. Нарушения не выдумывает (наследие AC-19 спеки).

Конфиг: .credentials/kimi.json
"""

import json
from typing import Optional

from config import load_kimi_config

TIMEOUT = 300
# reasoning расходует max_tokens — запас покрывает и размышления, и ответ.
MAX_TOKENS = 16000
MAX_FACTS_CHARS = 60000

SYSTEM_PROMPT = """Ты — старший аудитор PMO с 15-летним опытом контроля ИТ-проектов.
Тебе дан ДЕТЕРМИНИРОВАННЫЙ анализ проектного плана (JSON): метрики,
критический путь (CPM), нарушения корпоративной Инструкции (правила R-01…R-12
с evidence) и, при наличии, дифф с предыдущей версией плана.

Твоя задача — написать аудиторское заключение на русском языке:

1. **Общая оценка плана** (балл 1–10 и 2–3 предложения: насколько план
   управляем и реалистичен).
2. **Ключевые проблемы** — интерпретация найденных нарушений по убыванию
   важности: что это значит для проекта, чем грозит. Группируй, не перечисляй
   сотни строк — назови 3–5 главных тем с примерами из evidence.
3. **Критический путь и сроки** — оцени узкие места и просрочки.
4. **Дифф за период** (если есть) — что изменилось, куда движется проект.
5. **Рекомендации** — 5–7 конкретных действий PM, каждое со ссылкой на
   правило Инструкции (R-NN) или факт анализа.

ЖЁСТКИЕ ПРАВИЛА:
- Используй ТОЛЬКО факты из переданного JSON. Нельзя выдумывать нарушения,
  задачи, даты и причины. Если данных не хватает для вывода — скажи об этом.
- Каждый вывод подкрепляй ссылкой на факт: правило R-NN, метрику или задачу
  из evidence.
- Пиши плотно, по-деловому, без воды. Формат — Markdown (заголовки ##,
  списки). Объём — до 1500 слов."""


def analyze_plan(facts: dict, log_fn=print) -> Optional[str]:
    """Факты анализа → аудиторское заключение (Markdown) или None при сбое."""
    cfg = load_kimi_config()
    if not cfg:
        log_fn('⚠️ kimi.json не настроен, LLM-анализ недоступен')
        return None
    try:
        import requests
    except ImportError:
        log_fn('⚠️ requests не установлен, LLM-анализ недоступен')
        return None

    base_url = cfg.get('base_url', 'https://api.moonshot.ai/v1').rstrip('/')
    facts_text = json.dumps(facts, ensure_ascii=False, indent=1)
    if len(facts_text) > MAX_FACTS_CHARS:
        facts_text = facts_text[:MAX_FACTS_CHARS] + '\n…(усечено)'
    payload = {
        'model': cfg.get('model', 'kimi-k2.6'),
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content':
                'Детерминированный анализ плана (JSON):\n' + facts_text},
        ],
        # temperature не передаём: kimi-k2.x принимает только temperature=1.
        # thinking ВКЛЮЧЁН (качество > скорость): глубокий разбор фактов.
        'max_tokens': MAX_TOKENS,
    }

    import time
    for attempt in range(3):
        try:
            resp = requests.post(
                f'{base_url}/chat/completions',
                headers={'Authorization': f"Bearer {cfg['api_key']}",
                         'Content-Type': 'application/json'},
                json=payload,
                timeout=TIMEOUT,
            )
            if resp.status_code != 200:
                log_fn(f'⚠️ Kimi API вернул {resp.status_code}: {resp.text[:200]}')
                time.sleep(2 ** attempt)
                continue
            content = (resp.json().get('choices') or [{}])[0] \
                              .get('message', {}).get('content', '') or ''
            if content.strip():
                return content.strip()
            log_fn('⚠️ Kimi вернул пустой ответ, повторяю')
        except Exception as e:
            log_fn(f'⚠️ Ошибка вызова Kimi API: {e}')
            time.sleep(2 ** attempt)
    return None
