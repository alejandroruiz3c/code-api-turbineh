# ADR-0005 · How users interact: web app first, API second

- Status: accepted (Gate G0, 2026-10-10)
- Date: 2026-10-10

## Context

The product is "prompt → working, verified app in your GitHub". The plan exposes both a UI and
`POST /v1/builds`. The owner asked to choose the interaction that maximises UX, served at the deployment link
of the plan.

## Decision

1. **Primary surface: the web app** at the plan's deployment host. The API is a secondary channel on the same backend
   (the UI is just a client of it), for integrators and later for an MCP server / CLI.
2. Flow, one CTA per screen:
   1. **Home:** a single prompt box with the 5 recipe examples as one-click chips. No signup to type.
   2. **Clarify (only if needed):** the decider asks, in one batched request, a set of atomic Noul questions
      ("is the data model clear?", "are roles specified?"…). If anything is unclear the user gets at most
      3 multiple-choice chips — never a free-text interview.
   3. **Continue with GitHub** (one click, GitHub App) right before the build starts: identity for quotas/abuse
      and the target for delivery channel B.
   4. **Live build:** streamed phase trace (intent → selection → resolution → assembly → verification →
      delivery), chosen components with decider probabilities, token counter vs baseline (bench numbers only).
   5. **Result:** file tree viewer + docs (channel A artefact, always available) and one primary button
      **"Push to my GitHub"** (channel B). ZIP download as secondary.
3. Out-of-scope prompts get an honest answer with the closest recipe pre-filled as a chip.

## Consequences

- GitHub sign-in is required to build, not to explore → low friction and abuse control.
- The API keeps the plan's contract (`/v1/builds`, SSE events) so the UI and integrators share one path.

## Deployment host

**`software.turbineh.com`** (owner decision, 2026-10-10). `api.turbineh.com` keeps serving the YES IF landing.
The public API is served under the same host (`software.turbineh.com/v1/...`); DNS is managed at IONOS.
