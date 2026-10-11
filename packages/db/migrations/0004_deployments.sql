-- "Deploy for me" (ADR-0017): optional deployment into the client's own Vercel + database accounts.
-- Client credentials are stored encrypted only while the job is pending and erased when it ends (done or failed).
CREATE TABLE deployments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id         UUID        NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  owner_id         TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  vercel_token_enc TEXT,
  vercel_team_id   TEXT,
  db_mode          TEXT        NOT NULL CHECK (db_mode IN ('neon', 'url')),
  db_secret_enc    TEXT,
  admin_email      TEXT,
  step             TEXT,
  result           JSONB,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);
CREATE INDEX deployments_queue_idx ON deployments (created_at) WHERE status = 'queued';
CREATE UNIQUE INDEX deployments_one_active_idx ON deployments (build_id) WHERE status IN ('queued', 'running');
