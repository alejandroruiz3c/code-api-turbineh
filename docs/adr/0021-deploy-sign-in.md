# ADR-0021 · "Deploy for me" with sign-in (Vercel integration, Neon OAuth)

- Status: accepted (owner decision, 2026-10-12) · activation pending provider registration (see below)
- Date: 2026-10-12
- Extends: ADR-0017 (Deploy for me). Pasting a token stays available as a fallback.

## Decision

The client signs in instead of creating and pasting tokens:

- **Vercel:** a TurbineH integration (external installation flow). "Connect Vercel" → `/deploy/vercel/connect` →
  `https://vercel.com/integrations/<slug>/new?state=…` → the client picks personal account or team → Vercel calls
  `/deploy/vercel/callback?code&state&teamId&configurationId` → the code is exchanged server-side
  (`POST /v2/oauth/access_token`).
- **Neon:** OAuth 2.0 with PKCE (S256) at `oauth2.neon.tech`, scopes `openid urn:neoncloud:projects:create
urn:neoncloud:projects:read` only. Neon grants OAuth client credentials to commercial partners only.
- Each option appears only when its client credentials are configured (`VERCEL_INTEGRATION_*`, `NEON_OAUTH_*`);
  otherwise the current token/key fields are shown.

## Security

- `state`: 192 random bits, stored server-side bound to user + build + provider, mirrored in an httpOnly, Secure,
  SameSite=Lax cookie (path `/deploy`), single use, 30-minute expiry; the callback also requires the same session.
- PKCE verifier and tokens encrypted with AES-256-GCM (`DELIVERY_TOKEN_KEY`) in `deploy_connections`; a token is
  _taken_ (deleted) by exactly one deployment and then erased with the deployment, as in ADR-0017. Expired rows are
  purged. Provider error bodies are redacted and never shown.
- We do **not** uninstall the Vercel integration automatically: Vercel may delete the environment variables an
  integration created when it is uninstalled, which would break the client's app. Our token is erased after the
  deployment; `DEPLOYED.md` explains how to remove the integration safely (re-save the settings first).

## Activation (owner actions)

1. Vercel → Integrations Console (team turbineh) → Create: name "TurbineH", slug e.g. `turbineh-deploy`, Redirect URL
   `https://software.turbineh.com/deploy/vercel/callback` (staging: a second integration with
   `https://staging.software.turbineh.com/deploy/vercel/callback`), scopes: Projects RW, Deployments RW, Global
   Project Environment Variables RW, User R, Team R. Put `VERCEL_INTEGRATION_SLUG/_CLIENT_ID/_CLIENT_SECRET` in
   `.env.local` (staging: `STG_` prefix) and run `infra/staging/web.ts env`.
2. Neon → request OAuth client credentials (partner program) with redirect URIs `…/deploy/neon/callback`; then
   `NEON_OAUTH_CLIENT_ID/_SECRET` as above.
3. First live test: deploy once, then uninstall the integration in a test account and confirm whether Vercel keeps
   the environment variables created with the global scope; update `DEPLOYED.md` accordingly.
