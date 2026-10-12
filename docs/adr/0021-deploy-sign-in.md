# ADR-0021 · "Deploy for me" with "Connect Vercel" (integration sign-in)

- Status: accepted (owner decision, 2026-10-12) · activation pending the Vercel integration (see below)
- Date: 2026-10-12
- Extends: ADR-0017 (Deploy for me). Pasting a Vercel token stays available as a fallback.

## Decision

- **Vercel:** a TurbineH integration (external installation flow). "Connect Vercel" → `/deploy/vercel/connect` →
  `https://vercel.com/integrations/<slug>/new?state=…` → the client picks personal account or team → Vercel calls
  `/deploy/vercel/callback?code&state&teamId&configurationId` → the code is exchanged server-side
  (`POST /v2/oauth/access_token`).
- **Database:** unchanged (Neon API key or an existing PostgreSQL URL). Neon OAuth is reserved for Neon commercial
  partners; the owner decided not to pursue it (2026-10-12).
- "Connect Vercel" appears only when `VERCEL_INTEGRATION_SLUG/_CLIENT_ID/_CLIENT_SECRET` are configured; otherwise the
  token field is shown.

## Security

- `state`: 192 random bits, stored server-side bound to user + build, mirrored in an httpOnly, Secure, SameSite=Lax
  cookie (path `/deploy`), single use, 30-minute expiry; the callback also requires the same session.
- The token is encrypted with AES-256-GCM (`DELIVERY_TOKEN_KEY`) in `deploy_connections`, _taken_ (deleted) by
  exactly one deployment and then erased with the deployment, as in ADR-0017. Expired rows are purged. Vercel error
  bodies are redacted and never shown.
- We do **not** uninstall the integration automatically: Vercel may delete the environment variables an integration
  created when it is uninstalled, which would break the client's app. Our token is erased after the deployment;
  `DEPLOYED.md` explains how to remove the integration safely (re-save the settings first).

## Activation (owner action, once per environment)

Vercel → team turbineh → Integrations Console → Create (production: Redirect URL
`https://software.turbineh.com/deploy/vercel/callback`; staging: a second integration with
`https://staging.software.turbineh.com/deploy/vercel/callback`). Scopes: Projects RW, Deployments RW, Global
Project Environment Variables RW, User R, Team R. Then `VERCEL_INTEGRATION_SLUG/_CLIENT_ID/_CLIENT_SECRET` in
`.env.local` (staging: `STG_` prefix) and `infra/staging/web.ts env`. First live test: deploy once, then uninstall
the integration in a test account and confirm whether Vercel keeps the variables; update `DEPLOYED.md` accordingly.
