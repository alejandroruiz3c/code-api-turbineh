-- "Deploy for me" sign-in with Vercel / Neon (ADR-0021): short-lived OAuth state and the resulting access token,
-- bound to one user and one build. Tokens are encrypted, expire after 30 minutes and are deleted when a deployment
-- takes them (they then follow the deployments row, which erases them when the job ends).
CREATE TABLE deploy_connections (
  state         TEXT PRIMARY KEY,
  owner_id      TEXT        NOT NULL,
  build_id      UUID        NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  provider      TEXT        NOT NULL CHECK (provider IN ('vercel', 'neon')),
  verifier_enc  TEXT,
  token_enc     TEXT,
  team_id       TEXT,
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 minutes'
);
CREATE INDEX deploy_connections_owner_idx ON deploy_connections (owner_id, build_id, provider);

-- Deliverables explain how to remove the TurbineH integration safely when Vercel access came from sign-in.
ALTER TABLE deployments ADD COLUMN vercel_via TEXT NOT NULL DEFAULT 'token' CHECK (vercel_via IN ('token', 'integration'));
