-- Delivery channel B (PLAN §7.1): push a finished build to the user's own GitHub account.
-- The user's token is stored encrypted only while the delivery is pending and erased afterwards.
CREATE TABLE deliveries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id    UUID        NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  owner_id    TEXT        NOT NULL,
  channel     TEXT        NOT NULL DEFAULT 'B' CHECK (channel IN ('B', 'C')),
  repo_name   TEXT        NOT NULL,
  token_enc   TEXT,
  status      TEXT        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  repo_url    TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX deliveries_queue_idx ON deliveries (created_at) WHERE status = 'queued';
CREATE UNIQUE INDEX deliveries_one_active_idx ON deliveries (build_id) WHERE status IN ('queued', 'running');
