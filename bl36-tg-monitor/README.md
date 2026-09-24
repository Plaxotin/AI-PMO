# BL-36 «TG-надзор» — @PMO_vision_bot

Чат-бот мониторинга обсуждений проекта в Telegram-чатах: сбор сообщений (Bot API,
бот — админ чата), LLM-выделение сигналов (поручения/решения/риски/новости),
предложения РП с кнопками ✓/✕/✎, дайджест. Спека: `docs/specs/SPEC-BL-36-tg-monitoring.md`
(v0.2, также в Notion — карточка BL-36, свойство «Спецификация»).

## Структура

- `scripts/config.py` — конфиги из `.credentials/` (вне репо): telegram.json,
  kimi.json, supabase.json, config.json
- `scripts/db.py` — клиент Supabase REST (service key)
- `scripts/listener.py` — long-poll сбор сообщений, фильтр шума, /status, /usage
- `scripts/sense.py` — sense-making LLM-пайплайн (фаза 2, заглушка)
- `deploy/bl36-tg-monitor.service` — systemd-юнит

## Деплой (паттерн BL-6/BL-28)

1. Правка локально → `python -m py_compile scripts/*.py`
2. `scp -i ~/.ssh/timeweb_aipmo -r scripts/ root@195.133.14.151:/opt/bl36-tg-monitor/`
3. `systemctl restart bl36-tg-monitor`
4. Проверка: `ps aux | grep listener | grep -v grep | wc -l` = 1
5. Коммит + push в main.

Конфиги на сервере: `/opt/bl36-tg-monitor/.credentials/` — не коммитить.
