-- Intelligence Orchestration trials (ADR-0059): developers sign up on the landing page ("try it free"); the landing
-- server calls POST /v1/ai/trial-signups, which creates (or reuses) a TurbineH account for the email that is not tied
-- to any build (owner id `trial:<sha256(email) prefix>`) and issues an orchestration app token (ai_apps row with
-- build_id NULL). The $2 trial cap (ai_owner_spend, ADR-0053) applies to that account as to any other.
CREATE TABLE orchestration_trials (
  owner_id        TEXT        PRIMARY KEY,
  email           TEXT        NOT NULL UNIQUE,
  name            TEXT        NOT NULL,
  company         TEXT,
  use_case        TEXT,
  signups         INTEGER     NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_signup_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orchestration_trials_created_idx ON orchestration_trials (created_at DESC);

-- One row per signup (rate limits per email, per client IP and per day). The IP is never stored: only an HMAC of it.
CREATE TABLE orchestration_trial_signups (
  id          BIGSERIAL   PRIMARY KEY,
  owner_id    TEXT        NOT NULL,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orchestration_trial_signups_owner_idx ON orchestration_trial_signups (owner_id, created_at);
CREATE INDEX orchestration_trial_signups_ip_idx ON orchestration_trial_signups (ip_hash, created_at)
  WHERE ip_hash IS NOT NULL;
CREATE INDEX orchestration_trial_signups_created_idx ON orchestration_trial_signups (created_at);
