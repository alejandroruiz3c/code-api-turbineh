-- Demand emails (ADR-0056, ADR-0052 §4): one priority-list confirmation per demand row to the person who asked, one
-- alert per row to the owner, and the later "it's available now" notice. Each send is claimed by setting its
-- timestamp before calling the email provider (cleared again if the send fails, at most 3 attempts), so a row is never
-- emailed twice by concurrent web requests and the worker.
ALTER TABLE use_case_demand
  ADD COLUMN confirmation_sent_at  TIMESTAMPTZ,
  ADD COLUMN confirmation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN owner_alerted_at      TIMESTAMPTZ,
  ADD COLUMN owner_alert_attempts  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN available_notified_at TIMESTAMPTZ;
