-- TurbineH AI gateway (ADR-0029): AI apps use TurbineH's model and decider access through per-app tokens.
-- Tokens are stored as SHA-256 hashes (shown once). Usage is recorded per app, day, endpoint and model for billing;
-- prices are applied internally (ops), never stored here.
CREATE TABLE ai_apps (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           TEXT        NOT NULL,
  build_id           UUID        REFERENCES builds(id) ON DELETE SET NULL,
  name               TEXT        NOT NULL,
  token_hash         TEXT        NOT NULL UNIQUE,
  prefix             TEXT        NOT NULL,
  daily_token_quota  INTEGER     NOT NULL,
  requests_per_minute INTEGER    NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at         TIMESTAMPTZ
);
CREATE INDEX ai_apps_owner_idx ON ai_apps (owner_id, build_id) WHERE revoked_at IS NULL;

CREATE TABLE ai_gateway_usage (
  app_id         UUID    NOT NULL REFERENCES ai_apps(id) ON DELETE CASCADE,
  day            DATE    NOT NULL DEFAULT current_date,
  endpoint       TEXT    NOT NULL CHECK (endpoint IN ('chat', 'embeddings', 'decider')),
  model          TEXT    NOT NULL,
  calls          INTEGER NOT NULL DEFAULT 0,
  input_tokens   BIGINT  NOT NULL DEFAULT 0,
  output_tokens  BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, day, endpoint, model)
);

-- Per-minute request counter (serverless instances share no memory): one row per app and minute, pruned daily.
CREATE TABLE ai_gateway_minute (
  app_id  UUID        NOT NULL REFERENCES ai_apps(id) ON DELETE CASCADE,
  minute  TIMESTAMPTZ NOT NULL,
  calls   INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, minute)
);
