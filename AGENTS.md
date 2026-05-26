# AGENTS.md

## Repository identity

This workspace is the **AI-PMO** product repository on GitHub: **`Plaxotin/AI-PMO`** (landing in the root; product **specs** in `docs/specs/`, **plans** in `docs/plans/` — see `docs/README.md`). When the user says «репозиторий ai-pmo», they mean this repo unless they give another path or clone.

## Agent repository boundaries (mandatory)

**Do not open, clone, attach, or run tools against the repository `Konstantin-portfolio` (any owner/org, any casing).** Treat it as out of scope for all Cursor agents and subagents: no reads, no searches, no PRs, no cross-repo assumptions. If work seems to require that repo, stop and ask the user to provide what is needed in this repository or in chat instead.

## Cursor Cloud specific instructions

The repository has two parts:

1. **Landing** in repo root (`index.html`, inline CSS/JS, static Vercel deploy).
2. **Product app** in `app/` (Next.js + TypeScript for BL-6 implementation and API routes).

### Running locally

Landing (root):

```
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Product app (`app/`):

```
cd app
npm install
npm run dev
```

Then open `http://localhost:3000`.

### Key notes

- Root landing remains zero-dependency static (`vercel.json` has `"buildCommand": null`).
- Product development for BL-6 happens in `app/` with npm scripts (`dev`, `build`, `test`).
- Keep landing and product app changes isolated; do not mix landing-only assumptions with BL-6 app work.

## Subagent workflow

When work is split across subagents, follow `docs/SUBAGENTS_WORKFLOW.md`.

- Use exactly three workflow roles for phased development: `Planner`, `Implementer`, and `Verifier`.
- These roles are prompt profiles, not custom Cursor `subagent_type` values; launch them through the built-in subagent types described in `docs/SUBAGENTS_WORKFLOW.md`.
- The project-level custom subagents are defined in `.cursor/agents/`: `planner`, `implementer`, and `verifier` (`verifier` runs with `readonly: true`; `planner` may edit planning docs under `docs/` only, not product code — see `.cursor/agents/planner.md`).
- Keep phases sequential: only one active phase at a time.
- `Implementer` must ask the user for permission before starting each phase and is the only subagent that develops product code.
- `Verifier` must test each phase by the scenario from `Planner`; if no scenario exists, record that gap and test from the phase acceptance criteria.
