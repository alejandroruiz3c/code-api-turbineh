-- Append-only audit log (component domain.audit-log.turbineh): the database refuses to change or delete an entry,
-- whatever the code does. Applied by scripts/migrate.ts after the tables exist; idempotent.
CREATE OR REPLACE FUNCTION turbineh_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: rows cannot be changed or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION turbineh_append_only();
