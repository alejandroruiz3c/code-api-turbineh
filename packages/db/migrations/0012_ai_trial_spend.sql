-- Trial cap of the TurbineH orchestration (ADR-0053): cumulative inference spend, in USD, per TurbineH account (the
-- owner of the app tokens), across all of its AI apps. Incremented atomically after every gateway call; the gateway
-- refuses new calls once it reaches the cap (AI_TRIAL_CAP_USD, default 2). Internal cost, never shown as a price list.
CREATE TABLE ai_owner_spend (
  owner_id    TEXT           PRIMARY KEY,
  spent_usd   NUMERIC(14, 8) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now()
);
