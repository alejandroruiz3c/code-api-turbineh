-- Hedged chat requests of the TurbineH AI gateway (ADR-0043): per app, day and model, how many duplicate requests
-- were fired (they come out of the app's daily hedge budget) and how many of them answered first. The app is billed
-- only for the answer it receives; hedges are an internal cost, never shown to customers.
ALTER TABLE ai_gateway_usage
  ADD COLUMN hedges     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN hedge_wins INTEGER NOT NULL DEFAULT 0;
