# AGENTS.md

## Repository identity

This workspace is the **AI-PMO** product repository on GitHub: **`Plaxotin/AI-PMO`** (landing in the root; product **specs** in `docs/specs/`, **plans** in `docs/plans/` — see `docs/README.md`). When the user says «репозиторий ai-pmo», they mean this repo unless they give another path or clone.

## Agent repository boundaries (mandatory)

**Do not open, clone, attach, or run tools against the repository `Konstantin-portfolio` (any owner/org, any casing).** Treat it as out of scope for all Cursor agents and subagents: no reads, no searches, no PRs, no cross-repo assumptions. If work seems to require that repo, stop and ask the user to provide what is needed in this repository or in chat instead.

## Cursor Cloud specific instructions

This is a zero-dependency static landing page (single `index.html` with inline CSS/JS) deployed on Vercel together with the Next.js app in `app/` (see root `vercel.json`). Production URL: **https://ai-pmo-tawny.vercel.app/** — not `ai-pmo.vercel.app` unless that domain is added to the Vercel project.

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
- The project-level custom subagents are defined in `.cursor/agents/`: `planner`, `implementer`, and `verifier` (`verifier` runs with `readonly: true`; `planner` may edit planning docs under `docs/` only, not product code — see `.cursor/agents/planner.md`).
- Keep phases sequential: only one active phase at a time.
- `Implementer` must ask the user for permission before starting each phase and is the only subagent that develops product code.
- `Verifier` must test each phase by the scenario from `Planner`; if no scenario exists, record that gap and test from the phase acceptance criteria.
