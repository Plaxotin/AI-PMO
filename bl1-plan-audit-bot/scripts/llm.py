#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LLM-контур BL-1 (Kimi k2.6) — по образцу BL-6, но thinking ВКЛЮЧЁН.

Качество результата важнее времени и стоимости: большой max_tokens,
длинный таймаут, retry с backoff.

LLM получает ТОЛЬКО факты детерминированного анализа (analytics.run_analysis)
и интерпретирует их. Нарушения не выдумывает (наследие AC-19 спеки).

Структура заключения — по лучшим практикам:
- Asana (status reports): health-тег в начале, инвертированная пирамида,
  next steps с владельцами;
- PMI (EVM, performance reporting): variance analysis «причина → влияние →
  корректирующее действие», RAG, разделение рисков и проблем;
- DCMA 14-point: качество расписания по семействам structure/realism/performance.

Конфиг: .credentials/kimi.json
"""

import json
from typing import Optional

from config import load_kimi_config

TIMEOUT = 300
# reasoning расходует max_tokens — запас покрывает и размышления, и ответ.
MAX_TOKENS = 16000
MAX_FACTS_CHARS = 60000

SYSTEM_PROMPT = """Ты — старший аудитор PMO (PMP, 15+ лет контроля ИТ-проектов).
Тебе передан ДЕТЕРМИНИРОВАННЫЙ анализ проектного плана (JSON):
- metrics — метрики задач (выполнено/в работе/просрочено);
- cpm — критический путь;
- compliance — нарушения корпоративной Инструкции (R-01…R-12) с evidence;
- schedule_health — проверки качества расписания по методологии DCMA
  (семейства structure/realism/performance, статусы pass/fail/n/a);
- evm — освоенный объём (PV/EV/SPI; если proxy=true — веса по длительностям,
  в плане нет затрат, так и скажи);
- health — сводный статус (on_track/at_risk/off_track) с причинами;
- diff (если есть) — изменения к предыдущей версии плана.

Напиши аудиторское заключение на русском языке СТРОГО в этой структуре
(Markdown, заголовки ровно как указано):

## Резюме для руководства
Начни со статуса проекта (🟢/🟡/🔴 из health) и оценки плана по 10-балльной
шкале. 3–4 предложения: главный вывод, самое критичное, главное действие.
Инвертированная пирамида — самое важное первым.

## Ключевые проблемы
3–5 проблем по убыванию критичности. Каждую оформи так:
**Проблема.** Причина (из evidence) → влияние на сроки/проект → что делать.
Различай ПРОБЛЕМЫ (уже случились: просрочки, срывы базы) и РИСКИ
(могут случиться: узкий критический путь, задачи без связей).

## Качество расписания
Пройди по семействам DCMA-проверок (structure → realism → performance):
что сломано в логике сети, насколько правдоподобны даты, поспевает ли
команда (BEI, SPI). Проверки со статусом n/a не выдумывай — при необходимости
укажи одной строкой, что для полной проверки нужен .mpp.

## Соответствие корпоративной Инструкции
Сгруппируй нарушения R-01…R-12 в 2–4 темы (не перечисляй сотни строк):
суть темы, масштаб (count), ссылка на правило и пункт Инструкции.

## Динамика за период
Только если есть diff: что изменилось, тренд (улучшается/ухудшается),
знаковые сдвиги сроков. Если diff нет — раздел пропусти.

## Рекомендации
5–7 действий PM по убыванию приоритета. Формат каждого:
действие → зачем (ссылка на R-NN / проверку D-NN / метрику) → срок
(на этой неделе / за 2 недели / к следующему статусу). Действия должны
быть выполнимыми в MS Project/Excel, не абстрактными.

ЖЁСТКИЕ ПРАВИЛА:
- Используй ТОЛЬКО факты из переданного JSON. Нельзя выдумывать нарушения,
  задачи, даты, причины. Если данных не хватает для вывода — скажи об этом.
- Каждый вывод подкрепляй ссылкой на факт: правило R-NN, проверку D-NN,
  метрику (SPI/BEI/% просрочек) или задачу из evidence.
- Пиши плотно, по-деловому, без воды и без общих советов уровня
  «улучшите планирование». Объём — до 1500 слов."""


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
