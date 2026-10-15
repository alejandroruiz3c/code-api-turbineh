-- Scope gate (ADR-0052): requests the library does not cover (fully or in part) are refused before anything is
-- generated. Each one is recorded here so the owner sees the demand, and the person is subscribed to a priority
-- notification for when the library covers it. Read by GET /v1/ops/demand (staff only) and `pnpm --filter
-- @turbineh/db demand`.
CREATE TABLE use_case_demand (
  id          BIGSERIAL   PRIMARY KEY,
  build_id    UUID        REFERENCES builds (id) ON DELETE SET NULL,
  owner_id    TEXT,
  email       TEXT,
  request     TEXT        NOT NULL,
  status      TEXT        NOT NULL CHECK (status IN ('uncovered', 'partial')),
  use_case    TEXT,
  -- [{ "requirement": "...", "why": "..." }]
  missing     JSONB       NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One record per flow (a retried worker run never counts twice).
CREATE UNIQUE INDEX use_case_demand_build_idx ON use_case_demand (build_id) WHERE build_id IS NOT NULL;
CREATE INDEX use_case_demand_created_idx ON use_case_demand (created_at DESC);

-- Who asked to be told first when a missing use case is covered (one row per account or workspace).
CREATE TABLE priority_notifications (
  owner_id        TEXT        PRIMARY KEY,
  email           TEXT,
  subscribed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_request_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requests        INTEGER     NOT NULL DEFAULT 1,
  notified_at     TIMESTAMPTZ
);
