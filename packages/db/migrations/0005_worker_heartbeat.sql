-- Worker liveness for /health: each worker upserts its row every 30 s (no hostnames are exposed publicly).
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id text PRIMARY KEY,
  seen_at timestamptz NOT NULL DEFAULT now(),
  running integer NOT NULL DEFAULT 0
);
