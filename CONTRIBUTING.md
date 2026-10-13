# Contributing

- One branch and one PR per work package: `wp/<n>-<slug>`. Conventional Commits.
- Definition of Done: code + tests + green CI + updated docs + ADR if a decision was made + `CHANGELOG.md` entry.
- Exact dependency versions only, stable and published more than 14 days ago ([ADR-0002](docs/adr/0002-stack.md)).
- Secrets live only in `.env.local`. The pre-commit hook runs gitleaks; CI scans the full history.
- Model access always goes through `packages/decider`, `packages/compiler` or `packages/backup-coder`.
- Version compatibility, licences, permissions and test results are decided by code, never by a model.
- Never install, build or test third-party code outside the ephemeral sandbox.
- Public documentation is written in English. No metric may appear in docs or UI unless it comes from `bench/`.

## Catalogue contributions (recipes and components)

Every recipe template and native component must be **agent-ready** ([ADR-0032](docs/adr/0032-agent-ready-components.md)).
`pnpm catalog:validate` is the admission gate and fails on any of these:

- **Theme tokens only**: `bg-surface`, `bg-panel`, `bg-subtle`, `text-ink`, `text-muted`, `border-line`, `border-field`,
  `bg-brand`, `text-accent`, `text-danger|success|warning|info` (+ `-soft`). No fixed palette classes (`bg-white`,
  `text-slate-600`…): they break on dark brand backgrounds.
- **Offline E2E**: an external service is read from a base-URL env var and ships `tests/e2e/mocks/<ENV_VAR>.mjs`
  (answers `GET /health`); `playwright.config.ts` starts it and generates test secrets at runtime.
- **No secret-shaped literals** anywhere in tracked files, tests included.
- **Agent docs**: a recipe declares `guide.extend` (what / where / how, real paths); every page, route and actions
  file starts its default (or first) export with a one-line `/** doc */` — AGENTS.md is built from them.
- **Next 16**: `tsconfig.json` includes `.next/dev/types/**/*.ts`.
- Config comes from the spec (palette, currencies, sign-up policy), never hard-coded per demo; a fresh sign-in resumes
  the user's workspace.

Check a template end to end in the local sandbox: `pnpm --filter @turbineh/worker run verify:recipe <recipe>
["<prompt with colours>"] [--with <component,…>]`.

### Component documentation (every component)

Each component has a `guide.yaml` (`turbineh.guide/v0.1`, [ADR-0032 §Documentation](docs/adr/0032-agent-ready-components.md)):
what it does, use cases, when to use it and when not (with the alternative), trade-offs, configuration and inputs,
interfaces with real signatures, extension points, compatibility, security notes, guarantees each linked to a test
(`<file> › <title>`), known limits, a minimal example, keywords and synonyms. You may write it by hand; otherwise
`pnpm catalog:document <id>` writes it (facts from the code, narrative from our open model, every claim checked
against the code; generated parts listed under `generated`). A missing guide is never a rejection — document it.
After any guide change run `pnpm catalog:index` (the agent-readable index `apps/web/public/catalog/`).
