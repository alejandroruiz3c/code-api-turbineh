-- Owner usage report across products (ADR-0061): YES IF library + Intelligence Orchestration, per account.
--
-- 1 · Package downloads. `GET /v1/plans/{id}/package` redirects to a short-lived signed URL; each request is counted
--     here (no IP, no user agent), so the report can show "packages downloaded" from now on. ZIP links embedded in the
--     status responses go straight to object storage and cannot be counted.
CREATE TABLE flow_downloads (
  id          BIGSERIAL   PRIMARY KEY,
  build_id    UUID        NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  owner_id    TEXT        NOT NULL,
  format      TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX flow_downloads_owner_idx ON flow_downloads (owner_id, created_at);

-- 2 · Weekly email to the owner: one row per ISO week (e.g. 2026-W42) and kind. The cron claims the row before
--     sending (INSERT … ON CONFLICT DO UPDATE … WHERE status = 'failed'), so two cron runs in the same week send once;
--     a failed send is marked 'failed' and retried by the next run, at most 3 attempts.
CREATE TABLE owner_report_sends (
  period      TEXT        NOT NULL,
  kind        TEXT        NOT NULL DEFAULT 'weekly',
  status      TEXT        NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  attempts    INTEGER     NOT NULL DEFAULT 1,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ,
  email_id    TEXT,
  PRIMARY KEY (period, kind)
);
