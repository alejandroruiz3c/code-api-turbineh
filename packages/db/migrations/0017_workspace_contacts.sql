-- Contact email of a workspace (ADR-0074). Almost everyone enters with the shared invitation token, so their flows run
-- in an anonymous `invite:<uuid>` workspace with no email, and a refused request could not be followed up. The access
-- page now asks for an email and stores it here (one row per private workspace or account); it becomes the contact
-- email of that workspace's plans and builds. Only staff read it (owner report, demand list); never returned to anyone
-- but the workspace itself. `changes` / `window_start` rate-limit how often it can be changed.
CREATE TABLE workspace_contacts (
  owner_id     TEXT        PRIMARY KEY,
  email        TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  changes      INTEGER     NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Notify me when it's covered" on a refused flow (POST /v1/builds/{id}/notify): how many times the row's email was
-- set afterwards (capped per row).
ALTER TABLE use_case_demand ADD COLUMN email_updates INTEGER NOT NULL DEFAULT 0;
