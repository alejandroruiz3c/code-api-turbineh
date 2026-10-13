# ADR-0036 · Native fit in the coding agent's flow: `turbineh build`, agent instructions, MCP server, less waiting

- Status: accepted
- Date: 2026-10-12
- Context: Frontiers shop rerun (`bench/frontiers/ANALYSIS.md` §5 and §8 on `wip/frontiers-bench`). With TurbineH the
  agent still spent 8 tool calls on plumbing before doing anything useful: write the prompt to a file, POST
  `/v1/builds`, poll every 10 s, inspect the artefact, download a git bundle, clone, copy, and commit twice because git
  had no identity. Owner priority: TurbineH must plug into a coding agent's flow (Claude Code first, also Codex and
  Cursor) with zero extra work.

## Decision

### C1 · One command: `turbineh build "<spec>" | @spec.md`

- plan → generate → wait → write → commit → summary, in the current folder. `POST /v1/plans` gets `generate: true`:
  when the plan needs no decision from a person the worker requeues it for generation itself (no second request, no
  client poll in between). If it does need one, the command stops with exit 3 and `turbineh resume <id> --approve`.
- **Where the code goes.** A folder with `package.json` is a project: the capability package is adapted locally with
  the same code as the GitHub integration (ADR-0034: `analyseRepo` + `adaptPackage`, own folder in the source root,
  the project's aliases and database client, exact dependency versions merged without touching existing ones,
  settings by name in `.env.example`). Glue that would need the adaptation model uses its deterministic fallback (no
  model runs on the user's machine); the Security Pack basics it may import are embedded in the CLI bundle. Files the
  integration must modify may not carry uncommitted changes (exit 7); other uncommitted work is left alone and not
  committed. A folder without code (empty, docs, the spec, agent settings) gets the complete verified application
  (`GET /v1/plans/{id}/package?format=app`): existing files are never overwritten — `CLAUDE.md`/`AGENTS.md` get the
  package's guide first and keep what was there, `.gitignore` is unioned, anything else keeps the user's version and
  the package's is written next to it as `<name>.turbineh.<ext>`. Another kind of project (Python, Go…) is refused.
- **Commit.** One commit, with the user's git identity or, when none is set, `TurbineH <noreply@turbineh.com>` (the
  summary says which). ADR-0031 still holds: in an existing project TurbineH never commits on the default branch
  (`main`/`master`/`trunk`/`develop` → new branch `turbineh/<slug>-<id8>`); on a feature branch it commits there.
- **Summary** (human and `--json`): files added/modified/kept, gate steps, criteria met/open with the test that proves
  each met one and the files where each open one goes, `left[]`, required and missing settings, the next command, and
  a note that the package already passed the full gate (so the agent does not re-run it). Progress is at most four
  lines on stderr; `--json` writes one JSON object per line: `started`, `plan_ready`, then the result.
- **Exit codes**: 0 green · 1 error · 2 usage · 3 needs a person's decision · 4 still running after `--timeout`
  (default 20 min; the pending build is kept in `.turbineh/project.json`, `turbineh resume [id]` continues and writes)
  · 5 generation failed · 6 written and committed but the gate is not green · 7 local conflict.
- `install.sh` makes the CLI talk to the server it was installed from (`TURBINEH_INSTALL_URL`, after `TURBINEH_URL` and
  `login --url`) and prints the full path when the CLI is not on PATH.

### C2 · The agent knows TurbineH without being told

`turbineh init --agent claude|codex|cursor` writes a marked, idempotent block (≤ 15 lines) into `CLAUDE.md` (Claude
Code) or `AGENTS.md` (Codex, Cursor): when to use TurbineH, the one command (with a 600000 ms timeout or in the
background), how to read what is left, the exit codes. `--agent claude` also installs the project skill
`.claude/skills/turbineh/SKILL.md` with only documented frontmatter fields (`name`, `description`, `allowed-tools`).
When `turbineh` is not on PATH (fresh agent shells in containers), both are written with the CLI's full path.

### C3 · MCP server: `turbineh mcp`

A minimal implementation of the MCP stdio transport (newline-delimited JSON-RPC 2.0; `initialize` with version
negotiation 2025-11-25 … 2024-11-05, `ping`, `tools/list`, `tools/call`, progress notifications) instead of the SDK,
so the CLI stays one dependency-free file. Tools: build, resume, search, plan, apply, status, left, verify; each result
is exactly the command's `--json` document (text content and `structuredContent`, `isError` when not ok). Tested with
the official TypeScript SDK client (`@modelcontextprotocol/sdk` 1.30.1, test-only) over real stdio. Claude Code:
`claude mcp add turbineh -- turbineh mcp`.

### C4 · Less waiting

Measured on staging for the shop run (build `285b2287`, 183 s): queue 0.3 s · compile 3.3 s · select 0.6 s · resolve +
assemble 0.3 s · integrate 13.4 s · first verification 41.6 s (failed: typecheck and build broke on model-written glue
of two optional search components) · three correction rounds 29.6 s · full re-verification 92.3 s (lint 11.8, typecheck
18.4, unit 8.9, build 38.9, E2E 30.7) · report 1.8 s; delivery 4.2 s more. About 71 s (39 %) came from glue that failed
first. Changes:

- **Verified-glue cache**: glue a model wrote that is still in the app after a green gate is stored (component, library
  version, capability; 30 days) and reused by later builds instead of asking the model again.
- **No client poll gaps**: the plan continues into generation server-side; the CLI checks every 1 s for the first 30 s
  and every 2 s after (was 3 s; the agent's own loop was 10 s).
- **Start early**: `plan_ready` arrives seconds after the start with the components and the criteria that no shipped
  test will prove (`criteria.open`), computed by code from the recipe's and components' `acceptance.yaml` — the agent
  can plan the open parts while the package builds.

### C5 · The full spec goes through

`need` accepts up to 20,000 characters (`/v1/plans` and `/v1/builds`), so a spec file is sent whole; the compiler
writes up to 15 criteria, one per behaviour the request states. Every criterion comes back in the plan
(`covered`/`open`) and in the summary (`met`/`open` with where), so the agent only works on the remainder.

## Consequences and limits

- Local adaptation does not run the project's package manager or migrations (third-party code stays in the sandbox);
  the summary says to install and lists the migration step from the adaptation.
- The capability is not re-verified inside the user's project by `build`; `turbineh verify` runs the project's own
  checks, and `apply --pr` keeps the sandboxed in-project verification of ADR-0034.
- The verified-glue cache only helps once a component's glue has passed a gate; curated `glue.ts` in the catalogue
  remains the better fix for frequently selected components.
