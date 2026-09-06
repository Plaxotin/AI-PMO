# AI PMO — контекст для Kimi Work

Файл-памятка для быстрого восстановления контекста в любом новом чате/устройстве.
Прочитай этот файл целиком в начале сессии.

## Проект

AI PMO toolbox — набор фич вокруг Telegram-ботов и Google Sheets.
Бэклог и статусы — в Notion (страницы BL-N). Репо: github.com/Plaxotin/AI-PMO (main).

## Сервер (Timeweb)

- SSH: `ssh -i ~/.ssh/timeweb_aipmo -o BatchMode=yes root@195.133.14.151`
- Бот BL-6 живёт в `/opt/openclaw-server/skills/task-registry/scripts/`
  (bot_handler.py, task_manager.py, llm.py, commands.py, feedback.py)
- Сервис: `task-registry-bot.service`, лог `/var/log/task-registry-bot.log`
- Бот BL-28 живёт в `/opt/bl28-requirements-bot/` (bot.py, generate.py, шаблон v2),
  сервис `bl28-requirements-bot.service`
- Конфиги (не в репо!): `.credentials/` — config.json, telegram.json, kimi.json, user_mapping.json
- Плановый дайджест: systemd `plaxotin-task-digest.timer`, пн–пт 06:17 UTC (9:17 МСК)
- OpenClaw gateway на том же сервере: telegram-канал и telegram-плагин ВЫКЛЮЧЕНЫ
  (channels.telegram.enabled=false, plugins.entries.telegram.enabled=false) — не включать.

## Деплой-цикл BL-6

1. Правка в локальном клоне `bl6-task-notifier/v2/scripts/`
2. `python -m py_compile <file>`
3. `scp -i ~/.ssh/timeweb_aipmo <file> root@195.133.14.151:/opt/openclaw-server/skills/task-registry/scripts/`
4. `systemctl restart task-registry-bot`
5. Проверка: `ps aux | grep bot_handler | grep -v grep | wc -l` = 1
6. Коммит + push в main.

## BL-6 «Task notifier» (@Plaxotin_task_bot) — статус: Реализовано (MVP)

- Реестры поручений в Google Sheets; маппинг колонок по ИМЕНАМ заголовков
  (COLUMN_SYNONYMS дублируется в bot_handler.py и task_manager.py — держать синхронно).
  Поле «Контрагент» (синонимы Компания/КА), «Проект» упразднён. Срок: Srok korr приоритетнее Srok plan.
- Вкладка «Контакты» (ФИО | Telegram | Компания) — источник логинов и компаний.
- Контрагент при создании = компания ответственного из «Контактов» (автоподстановка).
- При создании поручения бот проверяет привязку ответственного к TG-логину;
  если нет — спрашивает админа (можно «Пропустить»).
- Роли: user / admin. Суперадмин упразднён, доступ к бэку только через Kimi Work или консоль.
- LLM-режим (кнопка «Редактировать»): свободный текст → канонические команды (мультикоманды),
  предпросмотр с кнопками Да / Изменить / Нет, после «Да» — выполнение и выход из режима.
- LLM: kimi-k2.6; temperature не передаём; для перевода команд thinking отключён,
  для совета дайджеста — включён (max_tokens=8000, timeout=120).
- Дайджест: открытые поручения со сроком ≤ 14 дней, сортировка по дате, дни просрочки,
  дата в заголовке; плановый — с советом LLM; кнопка «Дайджест» — выбор чата.
- Переключатель «⏰ Авто-дайджесты» (dg_auto:toggle) гейтит плановые рассылки.
- Известная особенность: message_id отправленных дайджестов не сохраняются
  (удаление — только перебором, бот-участник может удалять только свои сообщения).

## BL-28 «Генератор требований к проекту» (@PMO_requirements_bot) — статус: MVP реализовано (06.09.2026)

- Локально: `bl28-requirements-generator/`; сервер: `/opt/bl28-requirements-bot/`,
  сервис `bl28-requirements-bot.service`. Деплой-цикл как у BL-6 (py_compile → scp → restart).
- Пайплайн: исходники (.docx/.txt/.md файлами и текстом в чат) → `generate.py` (kimi) →
  JSON по схеме → `fill_docx` в шаблон `project-requirements-template-v2.docx`
  (генерируется `create_template_v2.py`, структура — `parse_template.py` → template-structure-v2.json).
- Два режима: ⚡ Быстрый — бесплатно, kimi-k2.6, один вызов + thinking, 2–3 мин (~$0.05);
  💎 Pro — kimi-k3, посекционно (6 групп) + проход критика, 10–15 мин (~$0.62);
  бесплатный Pro-прогон: запрос админу → `/grant <uid>`. Usage — `outputs/_usage.jsonl`.
- Документ полностью на русском: приоритеты «Обязательно / Желательно / Возможно /
  Не входит», нумерация БТ/ФТ/НФТ, незаполненное — [уточнить].
- Название документа модель извлекает из исходников сама (заглушка «Проект» запрещена).
- Открытые вопросы — нумерованным сообщением в чат; ответы пользователя сохраняются
  в сессию (`data/<uid>/answers_NN.txt`, состояние — `data/<uid>/state.json`),
  кнопка «🔄 Перегенерировать с ответами» — без повторного списания Pro-квоты.
- Версии: каждый прогон = новый файл `v0.N` + строка в «Истории изменений» документа.
- Rate limit org Moonshot: вызовы последовательно, паузы 4 с, backoff; черновики секций
  в `outputs/_draft_<uid>.json` (resume), CLI-флаги `--sections-only` / `--from-draft`.
- Конфиги на сервере (не в репо!): `.credentials/` — telegram.json (token, owner_id),
  config.json (allowed_user_ids, pro_quota), kimi.json (модели kimi-k2.6 / kimi-k3).

## BL-1 «Аудит проектного плана» (Telegram-бот) — статус: каркас (старт 06.09.26)

- Отдельный бот (свой токен, сервис `plan-audit-bot`), каркас в `bl1-plan-audit-bot/`
  (scripts/: bot_handler, config, plan_model, plan_parser, analytics, diff, llm, report, pdf, state).
- Рамка фичи и решения — в Notion, страница BL-1. Спека SPEC-PLAN-AUDIT.md — вторична (веб-версия не строим).
- Решения 06.09.26: .mpp в MVP (MPXJ-конвертер на сервере); маскирования ПДн НЕТ;
  версии плана хранятся в истории Telegram (бот держит только file_id в state.json);
  PDF упрощённый (без диаграмм D-01…D-04).
- Пайплайн: файл → parse_plan → run_analysis (CPM + правила Инструкции R-01…R-12,
  детерминированно) → LLM Kimi k2.6 (thinking ВКЛЮЧЁН, max_tokens=16000, timeout=300)
  → сводка в чат + PDF. Качество результата важнее времени и стоимости анализа.
- LLM работает только с фактами аналитики — нарушения не выдумывает.
- Деплой (план): `/opt/plan-audit-bot/`, сервис `plan-audit-bot.service`, цикл как у BL-6.
- TODO: маппинг MPXJ JSON → Plan; эталонный корпус планов для регрессии качества.

## Ключевые люди

- Константин @plaxotin (uid 107227641) — владелец, админ
- Админы BL-6: @LizaDav (uid 1147870132), Рената Плахотина (uid 5696238266)

## Как работать со мной (договорённости)

- Отвечать по-русски, коротко; bash-команды — с понятным description.
- Перед Edit всегда Read; деплой только после py_compile; в конце — отчёт что сделано/нет.
- Push в git иногда падает с schannel-ошибкой — просто повторить.
