# ADR-0050 · Build freely, and always say what happened

- Status: accepted (number may need renumbering at merge); §4 superseded by ADR-0052
- Date: 2026-10-13
- Context: the owner tested production (software.turbineh.com) on 2026-10-13 and reported two problems.
  1. Flow `0bfd9dff` (plan on a connected repository → "Generate & verify"): the flow page said "What happened: A check
     did not pass, so nothing was delivered. → Start the flow again…" while the generation was still running. It
     finished verified 11/11 at 22:41:04; the owner had left the page at 22:41:08 and never saw the result. Root cause:
     the plan and the generation share one build row and one event trace. The SSE stream ended at the first `finished`
     event, which was the **plan's**; the page then loaded a row in `queued`/`running` without a package and rendered
     the failure panel. Every plan → generate flow from `/flows/new` was affected. Worker logs (Scaleway and AWS) show
     no error in the window.
  2. Flow `92b75be1` (stack only: TypeScript · Next.js · "next 16, node 24, postgres 17", the wizard's defaults):
     "next.js detected: this flow ships Next.js App Router routes. Its server modules (src/) can be reused; the pages
     need porting. Not covered yet: Adaptation to your concrete project is pending: only the stack was declared, no
     project files were analysed." The wizard sends the display name "Next.js", which became "next.js" and never
     matched "nextjs", so our main path was "incompatible" and "Generate & verify" was disabled. A declared stack also
     always added "adaptation pending", although a stack-only flow is a new project with nothing to adapt.

## Decision

1. **The live trace follows the flow, not the first run.** A `finished` event ends the stream only when nothing was
   queued after it (`/v1/builds/{id}/events`); the page shows the latest run only (`lib/flow-events.ts`) and, if the
   result is still `queued`/`running`, keeps following it. A failure panel is shown only for `failed`.
2. **Every failure says what happened, why, what to do and offers one button** (`explainFailure` in the engine): Abuse
   Guard, spec not understood (T5), interruption on our side, a component being re-verified, timeouts, report-only
   security blocks, "Delivered, not verified", legacy out-of-scope runs and the generic case. The API returns it as
   `problem` on `/v1/builds/{id}` and in `FlowResult.errors` (CLI). "Generate again" resumes a generation that failed
   without a package from the same approved plan (`POST /v1/plans/{id}/generate` now accepts it). The raw reason stays
   under "Details for support".
3. **A declared stack builds a complete app.** Framework names are normalised ("Next.js", "next", "NextJS" →
   `nextjs`). A declared stack is never incompatible and never "adaptation pending" (`adaptationPending` is kept in
   the contract, always false). The plan carries `outcome` — what you get, what it means, notes and one-click actions —
   and `/flows/new` defaults to "A new complete app":
   - Next.js (or no framework): "A complete Next.js app, built for you" → Generate the complete app · Add it to my
     repository · Upload my project's files. The plan lists what the person receives, not changes to a project.
   - Another JS framework: what they get (a complete Next.js app whose server code under `src/` they import into
     their framework; the screens are not converted) and "Build a complete Next.js app instead" first.
   - Another language: a complete Next.js app run as a separate service, with the same one-click switch.
   - Existing projects (repository or files) keep explicit incompatibilities, rewritten the same way, and need approval.
     The wizard no longer disables generation on `compatible: false`; approvals are what a person must confirm.
4. **Superseded by [ADR-0052](0052-scope-gate-covered-use-cases-only.md) (2026-10-15): only covered use cases are
   operated; uncovered requests are refused with `use_case_not_covered`.** Original text, kept for history:
   **Free-form needs always lead to a buildable plan.** When the compiler finds no matching template, the need is built
   on the closest one (`closest_recipe`, else `saas-crud`) instead of failing "out of scope"; existing projects keep
   the component-only plan. The plan's `left` lists what stays open — gaps (written by TurbineH and verified),
   uncovered parts, and acceptance criteria no shipped test proves — each with where it is implemented (AGENTS.md ›
   What is left). Generation is blocked only by real safety reasons (Abuse Guard, blocking security findings), which
   are explained.

## Consequences

- Removed wording: "pages need porting", "only the stack was declared", "Adaptation to your concrete project is
  pending", "Not covered yet", "needs adaptation". Messages state what happened, what it means and the next action.
- Contract additions (shared): `Plan.outcome`, `Plan.left`, `PlanAction`, `PlanOutcome`, `PlanLeftItem`.
  `needsApproval` prefixes read "Before you continue:" and "In your repository:"; a dependency version conflict is
  listed once (the repository's wording) when a repository is connected.
- Tests: `packages/engine/src/build-freely.test.ts` (normalisation, stack-only plans, outcomes, message mapping),
  `apps/web/src/components/flow-stack-only.test.tsx` (the wizard's defaults through the engine to the rendered plan, and
  the production event sequence), `apps/worker/src/build-freely.test.ts` (closest-template plans).
