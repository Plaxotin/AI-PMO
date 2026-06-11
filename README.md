# AI PMO — Your AI-Powered Project Management Office

Landing page for AI PMO service.

## Tech Stack
- **Landing:** static HTML/CSS/JS (`index.html`) — Vercel root
- **App (BL-1):** Next.js in `app/` — реестр поручений, API `/api/projects/:projectId/assignments`
- Fonts: DM Sans, Instrument Sans (Google Fonts)

## Development

**Лендинг:** edit `index.html` → push to `main` → auto-deploy (Vercel root).

**Документация:** продукт и бэклог — [Notion](https://app.notion.com/p/33a2fbb64c0e80baa2e4f8cac9adb618); спеки реализации и планы фаз — `docs/README.md` (`docs/specs/`, `docs/plans/`).

**Приложение (BL1-0+):** см. `app/README.md` и `docs/plans/BL1-0_ENV.md`.

```bash
cd app && npm install && npm run dev
```

## Links
- [Landing (production)](https://ai-pmo-tawny.vercel.app/) — static `index.html` on Vercel project **ai-pmo**
- [BL-6 assignments](https://ai-pmo-tawny.vercel.app/assignments)
- `ai-pmo.vercel.app` — **not** attached to this Vercel project (may show another site). To use it: Vercel → project **ai-pmo** → **Domains** → add `ai-pmo.vercel.app`.
- [Product page in Notion](https://www.notion.so/33a2fbb64c0e80baa2e4f8cac9adb618)
