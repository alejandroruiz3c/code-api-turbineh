# ADR-0014 · Security remediation before delivery, user report and fast verification

- Status: accepted (owner request, 2026-10-10)
- Date: 2026-10-10
- Related: ADR-0003 (Backup Coder), ADR-0009 (models), ADR-0010 (decomposition), ADR-0011 (sandbox), ADR-0013 (delivery)

## Context

The owner asked for three things: (1) security is critical — a build is only delivered after the system has fixed the
security and safety problems it found, and if alerts remain the user is asked whether we should improve it and
redeliver; (2) the report the user receives is written by the best open model for UX writing; (3) verification must be
as fast as possible **without losing any analysis**.

## Decision

### 1 · Static analysis joins the verification

Semgrep OSS (pinned image digest, `--network none`, read-only mounts, metrics off) runs TurbineH rules
(`packages/verifier/rules/turbineh-security.yml`): `eval`/`new Function`, child processes, raw SQL from template
strings, server actions without an authorization check, hardcoded secrets (ERROR); unsanitized HTML, sensitive data
in logs, open redirects (WARNING). Every rule carries a plain-language `explain`. Intentional exceptions need an
inline `nosemgrep` with a justification comment (e.g. the public waitlist action).

### 2 · Automatic remediation before delivery (`@turbineh/remediation`)

- **Scope `auto`** (every build): all static findings (errors and warnings) and every production-dependency advisory.
- **Scope `improve`** (user asks "Improve & redeliver"): everything, including development-only advisories.
- Dependencies: deterministic — the patched version comes from OSV and is pinned with `pnpm.overrides`; the lockfile
  is refreshed inside the sandbox (registry only, no secrets).
- Code: one call per affected file to the security specialist (Backup Coder slots, open weights: primary
  `deepseek-v4-flash`, secondary `glm-5.2`, automatic failover), with only that file and its findings (ADR-0010).
  Files over 600 lines are not sent. Each fixed file carries `// turbineh:security-fix <rules>`.
- **Routing with one batched decider request per round:** one atomic Choice per warning ("fix inside this file" /
  "needs a human decision"). Blocking findings (ERROR) are always attempted; a warning is skipped only when the
  decider is confident (≥ 0.7) that it needs a product decision. The decider routes work, it never waives a check.
- Dependency pins and per-file code fixes run in parallel in the same round, so most builds need a single round.
- **A fix must never break the app:** if a quality gate (lint, typecheck, build, unit, E2E) fails after a fix, the
  specialist repairs only the files the remediation touched, using the failing log (max 2 attempts).
- **Nothing is trusted from the model:** after every round the full verification runs again. Rounds: 2 (`auto`),
  3 (`improve`). A build with blocking findings or failing checks is not delivered.
- Remaining non-blocking alerts are delivered and explained (`alertsOf`); the result view asks the user whether to
  improve and redeliver. `POST /v1/builds/{id}/improve` queues a new build that restores the delivered repository from
  its bundle, runs scope `improve` and delivers a new package; the original is never modified.

### 2b · "Improve & redeliver": informed, once

- Offered only on normal builds that passed verification and still have alerts, and only if something is fixable.
- Before deciding, the user sees: how many of the remaining alerts can most likely be fixed (dependencies: a patched
  version exists in OSV — deterministic; code warnings: one Noul per alert in one batched decider request, ≥ 0.6),
  how many affect what is shipped to users, the estimated duration (range computed from this build's own measured
  verification time) and that it uses 1 build of the daily quota. Numbers are rendered by code, never by the writer.
- Allowed **once** per build (API returns 409 otherwise; idempotent per parent). The improved delivery is final: no
  further improvement is offered and its report says so.

### 3 · The report (`@turbineh/reporter`)

- Facts only: acceptance criteria, evidence produced by this build's tests, checks, components, gaps, alerts and fixes.
- The decider maps each acceptance criterion to the evidence with one atomic Choice per criterion in one batched
  request; matches below 0.5 confidence are reported as "Not verified automatically".
- The open writer model (`REPORT_WRITER_MODEL`, default `glm-5.2`, chosen from `knowledge/modelos-ia/` for writing
  quality) writes three short parts in parallel (summary, security, next steps) with small, tolerant JSON schemas and
  one retry; deterministic plain-language templates are the fallback. It never says "secure" or "bug-free".
- Output: `TURBINEH_REPORT.md`, `SECURITY.md` (checks, tools, what was fixed, remaining alerts, what was not checked)
  and the report in the build result (`metrics.report`) rendered in the web UI.

### 4 · Fast verification without removing checks

- Base image per lockfile hash (`turbineh/sandbox-base:<hash>`) with dependencies pre-installed; offline install
  as fallback.
- Secrets, static analysis and OSV scans run concurrently with the main container.
- In the main container, lint, typecheck, unit tests and production build run in parallel; Postgres starts at the
  beginning and E2E runs after migrations. No check was removed (the separate strict typecheck stays).

## Consequences

- Verification time per build increases only when something has to be fixed (one extra full verification per round).
- Model cost: one specialist call per affected file and three short writer calls per build.
- Timings are measured in `bench/` before being published anywhere.
