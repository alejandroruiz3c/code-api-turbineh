/** Applies pending SQL migrations from packages/db/migrations in order. Idempotent. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv, readEnv } from "@turbineh/shared";
import { closePool, getPool } from "./client.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

export async function migrate(databaseUrl: string): Promise<string[]> {
  const db = getPool(databaseUrl);
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const done = new Set(
    (await db.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map(
      (r) => r.version,
    ),
  );
  const applied: string[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (done.has(file)) continue;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(join(dir, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return applied;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadLocalEnv();
  const applied = await migrate(readEnv().DATABASE_URL);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
  await closePool();
}
