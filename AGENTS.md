# AGENTS.md

## Cursor Cloud specific instructions

This is a zero-dependency static landing page (single `index.html` with inline CSS/JS) deployed on Vercel.

### Running locally

Serve files with any static HTTP server from the repo root:

```
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a browser.

### Key notes

- There is **no build step**, no package manager, no linting tooling, and no automated tests.
- The `vercel.json` sets `"buildCommand": null` — Vercel deploys the directory as-is.
- The page includes a client-side EN/RU language toggle and a mock email signup form (purely front-end, no backend calls).
- All styles and scripts are inline in `index.html`.

### Agent Skills (BL-1 и harness)

При задачах про **harness, tools, permissions, approval, MCP audit, agent loop, compaction, evals** — читать skill `agents-best-practices` (`.cursor/skills/agents-best-practices/`). При **реестре поручений, BL1-0/BL-1, API assignments, Telegram ingest** — skill `ai-pmo-assignments` (`.cursor/skills/ai-pmo-assignments/`). В Agent-чате: `@agents-best-practices` или `@ai-pmo-assignments`.
