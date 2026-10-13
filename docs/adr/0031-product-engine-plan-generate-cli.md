# ADR-0031 · Product engine: plan → generate → integrate, capability package and `turbineh` CLI

- Status: accepted
- Date: 2026-10-12
- Context: PLAN §16 (P2, P3, P5, P8). The product stops being "prompt → new app" and becomes "need → verified
  capability integrated into the user's project", for people and coding agents alike.

## Decision

- **One row, two modes.** A flow is a `builds` row. `POST /v1/plans` enqueues it with `options.mode = "plan"`: the
  worker compiles, selects and resolves (no assembly, no model-written code), stores `metrics.plan` and finishes.
  `POST /v1/plans/{id}/generate` requeues the same row with `mode = "generate"`, reusing the stored spec (no
  recompilation; the selection cache avoids repeating decisions). Needs without a complete flow get a component-only
  plan; any need with inference always includes `ai.orchestrator.turbineh` + `security.ai-safety.turbineh`.
- **Deterministic plan.** Stack detection, compatibility, dependency diff against the project's own `package.json`
  (only new dependencies are planned; a different major version is an incompatibility that needs approval, the
  project's version is kept), settings, estimate from `bench/` figures and `needsApproval` are code, never a model.
  Parts of the need a flow does not cover are stated (`missing`), never hidden.
- **Precise states** (`planning`, `planned`, `generating`, `generated`, `verified`, `integrated`,
  `integration_verified`, `deployed`, `failed`); `planning` was added to the shared contract (additive).
- **Capability package** (`turbineh.capability/v1`, PLAN §16.3): README, manifest.json, src/, examples/, tests/,
  config/.env.example, docs/{integration,architecture,verification}.md, agent/INTEGRATE.md, LICENSES/, as a ZIP
  written by our own dependency-free zip writer/reader (path traversal refused).
- **Integration never touches the default branch.** The CLI writes `turbineh/<slug>/` on branch
  `turbineh/<slug>-<plan8>` in one commit (only missing dependencies, settings by name in `.env.example`), `verify`
  runs the project's own scripts plus dependency and settings checks, `revert` reverts only that commit. The
  repository integration does the same through the GitHub Git Data API and opens a pull request; it never merges and
  the user's token is used once and not stored. Wiring into routes/UI is left to the user's coding agent
  (`agent/INTEGRATE.md`).
- **CLI distribution.** `@turbineh/cli` is bundled by esbuild into one file served at `/cli/turbineh.mjs`;
  `curl -fsSL https://software.turbineh.com/install.sh | sh` installs it (Node ≥ 20). Human and `--json` output carry
  the same state and the same actionable error (`code`, `message`, `action`, `resume`).
- **No third-party names on product surfaces (P8).** Surfaces say "TurbineH orchestration". The client orchestrator
  (component #001) talks only to our gateway with a plain `fetch` in the same request shape — no decider SDK in client
  apps (`turbineh.ai-sdk-dependency` now flags it too). Delivered reports show decision counts, not the decider's
  model or backend. Internal records keep them.

## Consequences and limits

- `verify` cannot prove the wiring of routes/pages it did not write; it says so (`limits`) and the state stays
  `integrated` until the project's own checks pass.
- The CLI does not run `install` for the user (third-party code); it reports missing installs as the next step.
- Plans for non-Next.js stacks are honest about adaptation (`incompatibilities`/`missing`) but not adapted
  automatically yet.
