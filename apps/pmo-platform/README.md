# AI PMO — платформа РП и Пиэмка

Текущий production-контур AI PMO: лендинг, веб-реестр, серверное состояние проекта и Telegram-сценарий «сигнал → риск → предложение → решение → поручение → результат».

Компонент добавлен отдельно от исходного Next.js-приложения в `app/`: старые боты, спеки и Vercel-лендинг не заменяются.

## Production

- Лендинг: https://4nbbao3eiuuc6.kimi.pro/landing.html
- Воркспейс: https://4nbbao3eiuuc6.kimi.pro/workspace.html
- Telegram webhook: `POST /api/telegram/webhook`

Публикацией управляет владелец продукта. В репозитории нет production-секретов и зашифрованных production-конфигураций.

## Архитектура

- React 19 + TypeScript + Vite — shell для Kimi OAuth.
- `public/landing.html` — текущий лендинг.
- `public/workspace.html` — основной интерфейс реестров и решений.
- Hono + tRPC 11 — backend и API.
- Drizzle ORM + MySQL/TiDB — проектные сущности и аудит.
- `api/routes/telegram.ts` — webhook и Telegram-сценарии.
- `deploy/telegram-gateway/server.mjs` — контролируемый исходящий шлюз к Telegram Bot API.

Production entry — `dist/boot.js`, порт — `3000`.

## Локальный запуск

1. Скопируйте `.env.example` в `.env` и заполните значения своего окружения.
2. Установите зависимости и подготовьте базу:

```bash
npm install
npm run db:push
npm run dev
```

Для локальной разработки Telegram дополнительно допустим `.credentials/telegram.env`; этот каталог исключён из git. Не помещайте Telegram-значения в переменные `VITE_*`.

Бинарные эталонные иллюстрации хранятся в `assets/public/*.base64` и автоматически восстанавливаются в `public/` перед `dev` и `build`. Ручное восстановление:

```bash
npm run assets:restore
```

Содержимое PNG не изменяется. Не заменяйте эталонную иллюстрацию без отдельного продуктового решения.

## Проверки

```bash
npm run check
npm run test
npm run build
```

Контрактные и браузерные проверки Telegram находятся в `verifier/v17/`. Перед ними нужны подготовленная тестовая БД и тестовый сервер; см. `verifier/README.md`. Не запускайте очистку тестовых данных в production.

## Telegram и роли

- Webhook проверяет `x-telegram-bot-api-secret-token`.
- Обрабатываются только chat IDs из серверного allowlist.
- Только РП из `TELEGRAM_RP_USER_IDS` может принять или отклонить предложение.
- Участники из `TELEGRAM_MEMBER_USER_IDS` могут отправлять сигналы и результаты.
- Дедупликация выполняется по Telegram `updateId` и паре `chatId + messageId`.
- Решение и поручение создаются атомарно; у решения может быть только одно связанное поручение.

Если используется controlled gateway, задайте `TELEGRAM_API_BASE_URL` и `TELEGRAM_GATEWAY_SECRET` только на backend. На самом шлюзе переменная называется `GATEWAY_SECRET`; он слушает `127.0.0.1:3101` и проксирует только allowlisted methods.

## Правила безопасности

- `.env`, `.credentials/`, SSH-пароли, токены и webhook/gateway secrets не коммитить.
- Не выводить секреты в логи, frontend, тестовые fixtures или документацию.
- Существующие значения платформенного `.env` не перезаписывать и не регенерировать.
- `api/lib/` и `api/kimi/` — framework internals; не модифицировать без отдельной необходимости.
- REST routes регистрировать в `api/boot.ts` до `/api/*` catch-all.
- Не использовать raw SQL, `db:push --force` или удаление таблиц для исправления миграций.

Следующие этапы и порядок передачи работы — в `docs/plans/PMO_PLATFORM_NEXT_STEPS.md` корневого репозитория.
