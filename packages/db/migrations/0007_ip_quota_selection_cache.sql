-- Viral capacity (PLAN §9, ADR-0027): per-IP daily quota and a selection cache.
-- The client IP is never stored: only an HMAC of it (keyed with a server secret), enough to count builds per day.
ALTER TABLE builds ADD COLUMN client_ip_hash TEXT;
CREATE INDEX builds_ip_day_idx ON builds (client_ip_hash, created_at) WHERE client_ip_hash IS NOT NULL;

-- Same normalized BuildSpec + same catalog candidates → same component selection, without calling the decider again.
CREATE TABLE selection_cache (
  key         TEXT PRIMARY KEY,
  result      JSONB       NOT NULL,
  hits        INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_hit_at TIMESTAMPTZ
);
