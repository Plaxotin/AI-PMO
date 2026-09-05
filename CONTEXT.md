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

## Ключевые люди

- Константин @plaxotin (uid 107227641) — владелец, админ
- Админы BL-6: @LizaDav (uid 1147870132), Рената Плахотина (uid 5696238266)

## Как работать со мной (договорённости)

- Отвечать по-русски, коротко; bash-команды — с понятным description.
- Перед Edit всегда Read; деплой только после py_compile; в конце — отчёт что сделано/нет.
- Push в git иногда падает с schannel-ошибкой — просто повторить.
