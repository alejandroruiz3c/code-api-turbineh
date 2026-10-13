# ADR-0040 · Closing the coding agent's loop: blessed public and pre-membership actions, no secret-shaped defaults

- Status: accepted (G4a and G4b); G4c (local gate) and G3 (criteria re-check) pending — see "Not done yet"
- Date: 2026-10-13
- Context: learning round of 2026-10-13 (`bench/frontiers/ANALYSIS.md` §12 on `wip/frontiers-bench`, root cause G4).
  Three of the four gate FAILs were `turbineh.server-action-without-authz` on legitimate actions the agents wrote —
  accepting an invitation (client-portal `src/app/invite/[token]/actions.ts:19`, saas-crud
  `src/entities/members/actions.ts:174`) and a public booking with a cancel link (bookings `src/app/actions.ts:28,50`) —
  plus `turbineh.hardcoded-secret` on a build placeholder the bookings agent put in `src/env.ts`
  (`BETTER_AUTH_SECRET: "build-placeholder-…"`, written because `next build` failed without `.env.local`). The
  template had no blessed way to write either kind of action, and its own public forms used `nosemgrep`.

## Decision

1. **Two helpers in the base template** (`src/server/authz.ts`, component `authz.roles.turbineh`, inherited by every
   recipe):
   - `requireSession()`: signed in, not necessarily a member (accept an invitation, onboarding, first workspace);
     redirects anonymous callers to sign-in.
   - `publicAction(name, { rateLimit, schema, refuse? }, handler)`: the one way to expose an action to anonymous
     visitors. Every call is rate-limited per client IP, then validated with the Zod schema, before `handler` runs;
     works with `<form action>` and `useActionState`. The waitlist and contact templates use it (no more `nosemgrep`).
2. **The rule** `turbineh.server-action-without-authz` accepts both (and own helpers named `require*`/`assert*`/…),
   now also checks `export const x = async (…) => …` / `async function` expressions, and rejects
   `publicAction` without `rateLimit` or `schema`. Its message names the helpers, so the agent sees the fix. Rule tests
   use the learning round's exact actions: as written they are still flagged; rewritten with the helpers they pass.
3. **Settings pattern**: required settings have no `.default()` and no placeholder in code. During `next build` only
   (`NEXT_PHASE=phase-production-build`), `src/env.ts` fills missing required values with throwaway values generated
   at runtime (`crypto.randomUUID()`); `next start` validates the real ones. Tests generate their secrets at runtime
   (`playwright.config.ts`, unchanged). The template unit tests prove both and that `src/env.ts` has no secret-shaped
   literal.
4. **AGENTS.md** extension points "Add a public action", "Add an action for signed-in non-members" and "Add a setting
   or secret"; recipe guides (bookings, client-portal, landing-waitlist, corporate-site) point to the helpers;
   "Before handing over" reminds the three kinds of action and the no-literal rule.

## Not done yet (next steps)

- **G4c** `turbineh verify --full`: run gitleaks 8.30.1 (`ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0…`,
  `--report-path -`, redacted), Semgrep 1.178.0 (the gate's pinned image, rules embedded in the CLI bundle), OSV
  (package coordinates only) and the licence policy (in-process read of `node_modules/.pnpm`) locally; local pinned
  binaries as fallback; file:line + fix; non-zero exit on blocking findings; then name it in AGENTS.md "Before handing
  over"; plus a tool-free secret-literal check in
  the default `verify`.
- **G3**: hand-written `acceptance.yaml` rules bypass `proofVerdict` (bookings: "the owner books a slot and sees it in
  the calendar" covered 7 unrelated criteria). Attach the shipped test's title and assertions as `proof` to every
  rule, re-evaluate the 9 learning-round packages and report precision.

## Consequences

- Agents get a documented, rule-accepted way to write public and pre-membership actions instead of disabling the rule.
- A deploy or agent `pnpm build` no longer needs `.env.local`; a missing setting still stops the app at start.
