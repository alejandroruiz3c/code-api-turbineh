# ADR-0013 · Delivery scope: complete package + "push to my GitHub" only

- Status: accepted (owner decision, 2026-10-10)
- Date: 2026-10-10
- Supersedes: PLAN §7.1 channel C and the customer-delivery parts of ADR-0007 and the product description

## Decision

Every build delivers exactly two things:

1. **Channel A — the complete, verified package** (zip + git bundle + docs) stored privately and downloadable with a
   short-lived signed URL. This is the source of truth of every delivery.
2. **Channel B — "Push to my GitHub"**: the signed-in user pushes it as a private repository to **their own**
   GitHub account (one git push, `repo` scope requested only at that moment).

**Out of scope for this project:** deploying or hosting repositories in a TurbineH-owned GitHub account or
organization for customers ("channel C"). No code, queue, GitHub App or quota is built for it. If it is ever needed,
it is a new decision with its own ADR.

## Consequences

- The `deliveries.channel` column keeps only `B` in use.
- No TurbineH GitHub credentials are used for customer deliveries; the platform token is limited to this repository.
