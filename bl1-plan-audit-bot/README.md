# BL-1 — Telegram-бот «Аудит проектного плана»

Отдельный Telegram-бот (свой токен, свой systemd-сервис) на сервере Timeweb.
Рамка фичи и решения — в Notion: *Бэклог AI PMO → BL-1 «Аудит проектного плана»*.
Спека `docs/specs/SPEC-PLAN-AUDIT.md` — вторичный источник требований.

## Суть

PM присылает боту файл плана (.xlsx / .csv / .mpp) → бот считает
детерминированную аналитику (CPM, метрики, правила Инструкции R-01…R-12,
проверки качества расписания по DCMA 14-point, EVM PV/EV/SPI) →
LLM (Kimi k2.6, thinking включён) интерпретирует факты → бот отвечает
краткой сводкой в чат + PDF-отчётом.

Отчёт построен по лучшим практикам: Asana (health-тег on track / at risk /
off track, инвертированная пирамида, next steps со сроками), PMI (EVM,
variance analysis «причина → влияние → действие», RAG), DCMA 14-point
(семейства structure / realism / performance, пороги pass/fail).

**Качество результата важнее времени и стоимости анализа.**

## Принципы

- Один чат, одно действие — отправить файл.
- LLM не выдумывает нарушения: работает только с фактами детерминированного анализа.
- Stateless по файлам: план не сохраняется на сервере после анализа.
  Предыдущие версии живут в истории Telegram — бот хранит только file_id
  (метаданные) в `state.json` и при необходимости пересскачивает файл через getFile.

## Структура

```
scripts/
  bot_handler.py   # Telegram polling, команды, обработка документов, пайплайн
  config.py        # загрузка .credentials/ (telegram.json, kimi.json)
  plan_model.py    # dataclass Task / Plan
  plan_parser.py   # .xlsx/.xls/.csv → Plan (маппинг колонок по именам); .mpp → MPXJ
  analytics.py     # CPM, метрики, правила Инструкции R-01…R-12 (детерминированно)
  diff.py          # сравнение двух версий плана
  llm.py           # Kimi k2.6: интерпретация фактов, рекомендации (thinking on)
  report.py        # краткая сводка для чата
  pdf.py           # упрощённый PDF-отчёт (reportlab)
  state.py         # история file_id по чатам (метаданные, не файлы)
tests/
  test_smoke.py    # импорты + мини-тест CPM
```

## Конфиги (НЕ в репо): `scripts/../.credentials/`

```json
// telegram.json
{"bot_token": "...", "admin_ids": [107227641]}
// kimi.json
{"api_key": "...", "base_url": "https://api.moonshot.ai/v1", "model": "kimi-k2.6"}
```

## Деплой (по образцу BL-6)

1. Правки локально, `python -m py_compile scripts/*.py`
2. `scp -i ~/.ssh/timeweb_aipmo -r scripts/ root@195.133.14.151:/opt/plan-audit-bot/`
3. `systemctl restart plan-audit-bot`
4. Проверка: `ps aux | grep bot_handler | grep -v grep | wc -l` = 1

MPP-конвертер: Java + MPXJ на сервере, вызов через subprocess (см. plan_parser.py).

Статус: **каркас (skeleton)** — интерфейсы и LLM-контур готовы, тяжёлые
части помечены `TODO(IMPL)`.
