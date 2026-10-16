-- Per-request metrics of the AI gateway (ADR-0060): one row per product request (orchestrated chat, orchestrate,
-- agent step, MCP tool call, direct chat) that made at least one model call. Feeds the per-account usage report
-- (GET /v1/ai/v1/usage, MCP usage_report): requests, tokens, internal cost as charged to the trial, latency
-- percentiles and the cost of the same tokens at a frontier model's list price. No prompts or answers are stored.
CREATE TABLE ai_request_metrics (
  id                  BIGSERIAL     PRIMARY KEY,
  owner_id            TEXT          NOT NULL,
  app_id              UUID          NOT NULL,
  surface             TEXT          NOT NULL,
  ok                  BOOLEAN       NOT NULL,
  latency_ms          INTEGER       NOT NULL,
  model_calls         INTEGER       NOT NULL,
  input_tokens        BIGINT        NOT NULL,
  output_tokens       BIGINT        NOT NULL,
  cost_usd            NUMERIC(16,8) NOT NULL,
  reference_cost_usd  NUMERIC(16,8) NOT NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ai_request_metrics_owner_idx ON ai_request_metrics (owner_id, created_at);
