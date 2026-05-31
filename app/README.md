# AI PMO — приложение (Next.js)

Реестр поручений **BL-6 v2.2** (фаза **BL2-0**): Google OAuth, Google Sheets PMI, smart-input, LLM, SaluteSpeech инжест.

## Маршруты

- UI: `/assignments` — единый экран (smart-input + таблица + edit-mode)
- OAuth: `/api/auth/google`, `/api/auth/google/callback`
- API: `/api/projects/:projectId/sheets/*`, `/assignments`, `/assignments/parse`, `/ingest`

## Команды

```bash
npm install
npm run dev          # http://localhost:3000
npm run build
npm test
npm run verify:bl2-secrets
```

Секреты: `docs/plans/BL2-0_SECRETS_SETUP.md`, `docs/plans/BL1-0_ENV.md`.

**Приёмка (prod):** https://ai-pmo-tawny.vercel.app/assignments

## Деплой

Корневой `vercel.json` указывает `rootDirectory: "app"`. Лендинг в корне репозитория (`index.html`) — отдельный статический артефакт; прод-приложение BL-6 — Next.js из `app/`.
