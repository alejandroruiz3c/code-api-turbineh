-- Append-only publication log (component social.publish.turbineh): the database refuses to change or delete an entry,
-- whatever the code does. Applied by scripts/migrate.ts after the tables exist; idempotent.
CREATE OR REPLACE FUNCTION turbineh_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: rows cannot be changed or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS social_publication_log_append_only ON social_publication_log;
CREATE TRIGGER social_publication_log_append_only BEFORE UPDATE OR DELETE ON social_publication_log
  FOR EACH ROW EXECUTE FUNCTION turbineh_append_only();
