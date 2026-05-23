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

## Subagent workflow

When work is split across subagents, follow `docs/SUBAGENTS_WORKFLOW.md`.

- Use exactly three workflow roles for phased development: `Planner`, `Implementer`, and `Verifier`.
- These roles are prompt profiles, not custom Cursor `subagent_type` values; launch them through the built-in subagent types described in `docs/SUBAGENTS_WORKFLOW.md`.
- The project-level custom subagents are defined in `.cursor/agents/`: `planner`, `implementer`, and `verifier`.
- Keep phases sequential: only one active phase at a time.
- `Implementer` must ask the user for permission before starting each phase and is the only subagent that develops product code.
- `Verifier` must test each phase by the scenario from `Planner`; if no scenario exists, record that gap and test from the phase acceptance criteria.
