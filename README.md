# AI PMO — Your AI-Powered Project Management Office

Landing page and product components for AI PMO.

## Product components

- **AI PMO platform:** `apps/pmo-platform/` — актуальный контур лендинга, веб-реестра, server-side проектного состояния и реального Telegram-сценария. См. `apps/pmo-platform/README.md`.
- **Landing (legacy Vercel):** static HTML/CSS/JS (`index.html`) — Vercel root.
- **App (BL-1):** Next.js in `app/` — реестр поручений, API `/api/projects/:projectId/assignments`.
- Fonts: DM Sans, Instrument Sans (Google Fonts).

### AI PMO platform links

- [Current landing](https://4nbbao3eiuuc6.kimi.pro/landing.html)
- [Current workspace](https://4nbbao3eiuuc6.kimi.pro/workspace.html)
- [Handoff and next steps](docs/plans/PMO_PLATFORM_NEXT_STEPS.md)

## Development

**AI PMO platform:** работайте в `apps/pmo-platform/`; не переносите туда production `.env`, `.credentials/` или секреты каналов.

```bash
cd apps/pmo-platform
cp .env.example .env
npm install
npm run dev
```

**Лендинг Vercel:** edit `index.html` → push to `main` → auto-deploy (Vercel root).

**Документация:** продукт и бэклог — [Notion](https://app.notion.com/p/33a2fbb64c0e80baa2e4f8cac9adb618); спеки реализации и планы фаз — `docs/README.md` (`docs/specs/`, `docs/plans/`).

**Приложение (BL1-0+):** см. `app/README.md` и `docs/plans/BL1-0_ENV.md`.

```bash
cd app && npm install && npm run dev
```

## Links
- [Landing (legacy production)](https://ai-pmo-tawny.vercel.app/) — static `index.html` on Vercel project **ai-pmo**
- [BL-6 assignments](https://ai-pmo-tawny.vercel.app/assignments)
- `ai-pmo.vercel.app` — **not** attached to this Vercel project (may show another site). To use it: Vercel → project **ai-pmo** → **Domains** → add `ai-pmo.vercel.app`.
- [Product page in Notion](https://www.notion.so/33a2fbb64c0e80baa2e4f8cac9adb618)
