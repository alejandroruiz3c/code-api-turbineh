# ADR-0030 · Invitation access token for the product area and API

- Status: accepted (owner decision, 2026-10-12)
- Date: 2026-10-12
- Context: PLAN §16. software.turbineh.com becomes only the product area; access is by invitation, without login.

## Decision

- One invitation token (`PRODUCT_ACCESS_TOKEN`, environment only — never in git) opens the product. The browser
  submits it once at `/access`; the server answers with an httpOnly, Secure, SameSite=Lax cookie holding a random
  **workspace id** signed with HMAC-SHA256 over a secret derived from the token and the auth secret. The token itself
  is never stored client-side, and rotating it invalidates every cookie.
- `proxy.ts` sends any page without a valid cookie to `/access` (optimistic check); every route handler checks access
  again on the server (`getCaller`).
- The API and the CLI send the same token as `Authorization: Bearer`, plus an optional `x-turbineh-workspace` header
  so each CLI/project keeps its own history. Owner of everything created: `invite:<workspace id>`.
- GitHub is optional (only to integrate into a repository). Existing API keys (`tbh_…`) keep working for internal
  benchmarks and integrations.

## Consequences and limits

- A shared token cannot be revoked per person: suitable for an invitation phase. Per-invite tokens (and billing per
  workspace) are the next step.
- Quotas apply per workspace and per client IP, as before.
