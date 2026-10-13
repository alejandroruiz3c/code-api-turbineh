/** Creates/updates auth tables (better-auth) and applies app migrations (drizzle). Idempotent. */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Migrations only create tables: they never sign or send anything, so they need no real auth settings. Placeholders
// (process-local, never stored) let `pnpm db:migrate` run with nothing but DATABASE_URL.
process.env.BETTER_AUTH_SECRET ||= randomBytes(32).toString("hex");
process.env.BETTER_AUTH_URL ||= "http://127.0.0.1:3000";
process.env.TURBINEH_DB_MIGRATE = "1";

const { getMigrations } = await import("better-auth/db/migration");
const { drizzle } = await import("drizzle-orm/node-postgres");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { auth } = await import("../src/lib/auth");
const { pool } = await import("../src/db/client");

const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
if (existsSync("./drizzle/meta/_journal.json")) {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
}
// Database rules drizzle-kit cannot express (ADR-0041), e.g. append-only triggers of audit and history tables:
// src/db/sql/*.sql, idempotent (CREATE OR REPLACE / DROP … IF EXISTS), applied in name order after the tables exist.
if (existsSync("./src/db/sql")) {
  for (const file of readdirSync("./src/db/sql")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await pool.query(readFileSync(join("./src/db/sql", file), "utf8"));
  }
}
await pool.end();
console.log("migrations applied");
