# ADR-0017 · "Deploy for me" into the client's own accounts (optional)

- Status: accepted (owner decision, 2026-10-11)
- Date: 2026-10-11
- Extends: ADR-0013 (delivery scope). TurbineH still does **not** host customer apps.

## Decision

Every build keeps delivering the complete package (zip + bundle, "Push to my GitHub"). On top of that, the client can
**optionally** press **Deploy for me**: TurbineH deploys the verified build into **the client's own accounts** and
returns an updated package.

1. The client gives a Vercel access token (we recommend a 1-day expiry) and either a Neon API key (we create the
   database) or an existing PostgreSQL connection string; an admin email if the app has an admin panel.
2. The worker: validates the token → creates the database (Neon, `aws-eu-central-1`) → creates the Vercel project
   (`buildCommand: pnpm db:migrate && pnpm build`, functions in `fra1`) → sets the settings as encrypted/sensitive
   production variables (`BETTER_AUTH_SECRET`, `JOBS_RUNNER_SECRET`/`CRON_SECRET` generated at random) → uploads the
   repository files (`git ls-files`, never `.env*`) → deploys → waits for `READY` → checks `/` and `/sign-in`.
3. Deliverables adapted: `DEPLOYED.md` (live URL, what was created where, what is left: domain, email, team,
   backups, how to connect Git for future changes), `START_HERE.html` in "Live" mode, README pointer, new package.

## Security

- Client credentials: HTTPS only, AES-256-GCM at rest while the job is pending, **erased when the job ends** (done or
  failed), never logged; error messages are redacted.
- Migrations run inside the client's own Vercel build: the client's database URL never reaches TurbineH machines
  except as an encrypted value forwarded to Vercel.
- One active deployment per build; endpoints require the build owner (session or API key).

## Limits and follow-ups

- Vercel Hobby limits cron jobs to daily; documented in `DEPLOYED.md`.
- OAuth ("Connect Vercel" / Neon partner integration) would remove token copy-paste; follow-up.
- A fully managed hosting by TurbineH (Lovable-style) remains out of scope (would need its own ADR).
