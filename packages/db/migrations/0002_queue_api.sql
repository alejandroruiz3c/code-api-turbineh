-- Build queue, API keys, quotas and delivery (PLAN §7, §9).
ALTER TABLE builds
  ADD COLUMN owner_id        TEXT,
  ADD COLUMN api_key_id      UUID,
  ADD COLUMN idempotency_key TEXT,
  ADD COLUMN options         JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN attempts        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN claimed_by      TEXT,
  ADD COLUMN claimed_at      TIMESTAMPTZ,
  ADD COLUMN artifact        JSONB,
  ADD COLUMN repo_url        TEXT,
  ADD COLUMN error           TEXT;
CREATE UNIQUE INDEX builds_idempotency_idx ON builds (owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX builds_queue_idx ON builds (created_at) WHERE status = 'queued';
CREATE INDEX builds_owner_idx ON builds (owner_id, created_at DESC);

-- API keys: only a SHA-256 hash is stored; the plaintext is shown once at creation.
CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  key_hash    TEXT        NOT NULL UNIQUE,
  prefix      TEXT        NOT NULL,
  daily_quota INTEGER     NOT NULL DEFAULT 20,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

-- Global cost circuit breaker (ADR-0008): one row per day.
CREATE TABLE cost_ledger (
  day        DATE PRIMARY KEY,
  builds     INTEGER NOT NULL DEFAULT 0,
  eur        NUMERIC(10, 4) NOT NULL DEFAULT 0
);
