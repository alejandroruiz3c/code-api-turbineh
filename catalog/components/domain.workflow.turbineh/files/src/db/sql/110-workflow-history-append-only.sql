-- Immutable workflow history (component domain.workflow.turbineh): the database refuses to change or delete a state
-- change, whatever the code does. Applied by scripts/migrate.ts after the tables exist; idempotent.
CREATE OR REPLACE FUNCTION turbineh_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: rows cannot be changed or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workflow_events_append_only ON workflow_events;
CREATE TRIGGER workflow_events_append_only BEFORE UPDATE OR DELETE ON workflow_events
  FOR EACH ROW EXECUTE FUNCTION turbineh_append_only();
