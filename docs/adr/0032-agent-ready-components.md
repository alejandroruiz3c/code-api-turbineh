# ADR-0032 · Agent-ready packages and catalogue components

- Status: accepted (2026-10-12)
- Context: Frontiers benchmark runs (`bench/frontiers/ANALYSIS.md` on `wip/frontiers-bench`). With our package the coding
  agent still had to re-theme every screen, fix a swapped FAQ, add image URLs, search over descriptions, restrict
  sign-up, fix a workspace bug after sign-in, write a Stripe stub for an offline paid-path E2E and read most of the
  repository to find what was left; it then re-ran install/build/E2E several times.

## Decision

The measure is the owner's: **a coding agent that receives our package has almost nothing left to do, and knows
immediately what is left.** Every recipe template and native component follows this standard, and what can be checked
mechanically is enforced by `pnpm catalog:validate` (admission gate: nothing is approved without it).

1. **Theme tokens only.** Screens use token utilities (`bg-surface`, `bg-panel`, `bg-subtle`, `text-ink`, `text-muted`,
   `border-line`, `border-field`, `bg-brand`/`text-brand-contrast`, `text-accent`, `text-danger|success|warning|info`
   and their `-soft` backgrounds) defined in `src/app/globals.css` `@theme`. No fixed palette classes
   (`bg-white`, `text-slate-600`, …). _Checked._
2. **Config derived from the spec.** The compiler extracts the palette stated in the prompt (background, accents,
   call-to-action, text, type) deterministically; the assembler derives the full token set with WCAG contrast (text
   ≥ 7:1, secondary/status ≥ 4.5:1, dark backgrounds included). An uploaded brand still wins. Same rule for currencies
   (existing) and the sign-up policy (recipe: `src/lib/sign-up-policy.ts`).
3. **Offline E2E with shipped mocks.** Every external service is reached through a base-URL env var and ships a mock
   `tests/e2e/mocks/<ENV_VAR>.mjs` (answers `GET /health`). The template's `playwright.config.ts` starts every mock,
   points the env var to it and generates test secrets at runtime. _Checked_ (a `fetch` driven by `*_API_BASE`,
   `*_BASE_URL`, `*_API_URL`, `*_AI_URL` needs its mock).
4. **No secret-shaped literals** in tracked files, tests included (`sk_test_…`, `whsec_…`, private keys). _Checked._
5. **Auth resume.** A fresh sign-in resumes the user's first workspace (session hook + `requireMember` fallback); a
   sign-out → sign-in E2E covers it. Staff-only apps use the shared allowlist (`src/lib/staff.ts`, `ADMIN_EMAILS`,
   deny by default). **Staff rights require a verified email**: better-auth sends a verification link on sign-up
   (through `sendEmail`, logged when there is no provider) and `isStaff()` grants staff/admin only when
   `session.user.emailVerified === true` — otherwise anyone signing up first with the owner's address would become
   staff. E2E setup verifies through the logged link (no test-only path in the app); a test proves an unverified
   allowlisted address gets no staff access and gets it after verification.
6. **Agent docs.** Every package ships `AGENTS.md` (+ `CLAUDE.md` importing it) and `turbineh.json`
   (`turbineh.package/v1`): purpose, file map by area (from each file's top-level doc comment), extension points
   (base + recipe `guide.extend`), theme tokens, env vars (required/optional from `src/env.ts`), acceptance criteria
   **met** (with the passing test that proves it) or **open** (with the files where it belongs), the verified gate
   results, and the cheapest command per kind of change. _Checked:_ recipe `guide.extend` exists and points to real
   files; every page/route/actions file has a top-level doc comment.
7. **Next 16 ready.** `tsconfig.json` includes `.next/dev/types/**/*.ts` so `next build` never rewrites it. _Checked._
8. **Honest gate.** Findings are labelled security / policy / quality (`gateFindings`); policy findings (licence list,
   secret-shaped placeholders) still block where policy says so but are not reported as vulnerabilities.
   `server-action-without-authz` exempts sign-in/out/up actions; `ai-direct-model-call` also catches
   OpenAI-compatible endpoints configured by env.

## Consequences

- `turbineh left` / `turbineh verify` read `turbineh.json` in a delivered package; `pnpm --filter @turbineh/worker run
verify:recipe <recipe> [--with <components>]` runs the full gate on a template locally.
- On `main` before this change the new checks found 257 issues across all 11 recipes and 2 native components; all
  were fixed in the same change.
- Criteria are "met" only when the gate passed and the report matched a passing test to them; the matching uses the
  existing report mapping (decider), the pass/fail itself is deterministic.

## Documentation standard (amendment, 2026-10-13)

Every catalogue component is documented to one standard: `guide.yaml` (`turbineh.guide/v0.1`, the format of
ADR-0033): title, summary (what it does and does not), use cases, when to use it / when not (with the alternative),
trade-offs (choice, gain, cost), configuration and inputs, interfaces with real signatures, extension points,
compatibility, security notes, guarantees each linked to a test (`<file> › <title>`), known limits, a minimal example,
keywords and synonyms.

- **Documented, never rejected.** A component without a complete guide is documented by the intake documentation
  step (`pnpm catalog:document`, run automatically by `pnpm catalog:curate` after certification): deterministic facts
  from the code (importable names and declaration signatures, env vars, install line, dependencies and versions,
  licence and effects, test titles, the package README as text), narrative drafted by our open model (the compiler
  slot) and then checked by code — interfaces must exist, guarantees must quote an existing test title, alternatives
  must exist in the catalogue, the example may import only what the component provides; unsupported claims are
  dropped. Generated sections are listed under `generated`. Hand-written guides win and are never overwritten.
- **Completeness is checked after documenting.** `pnpm catalog:validate` reports missing or incomplete guides as
  "document it" (and keeps failing CI until they exist); security, licence and test gates still block as before.
- **Used in three places.** `turbineh search` and `/v1/capabilities` (keywords, use cases, when to use and not,
  trade-offs, tested guarantees), the agent-readable index `/catalog/index.json` + `/catalog/llms.txt`
  (`pnpm catalog:index`, checked for freshness by `catalog:validate`), and apps (`docs/components/*.md`).
- **Decider.** A compact card (what it does, two use cases, provides) is available to selection behind
  `DECIDER_DOC_CARDS=1`. On the selection bench (19 labelled multi-candidate cases, `bench:selection`) the manifest
  one-liners scored 17/19 and the best documentation card 16/19 at the same latency, so production keeps the
  one-liners until a bench run shows a gain; longer cards with limits or "avoid when" scored lower (they read as risk).
