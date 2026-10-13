/** Creates/updates auth tables (better-auth) and applies app migrations (drizzle). Idempotent. */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

// Migrations only create tables: they never sign or send anything, so they need no real auth settings. Placeholders
// (process-local, never stored) let `pnpm db:migrate` run with nothing but DATABASE_URL.
process.env.BETTER_AUTH_SECRET ||= randomBytes(32).toString("hex");
process.env.BETTER_AUTH_URL ||= "http://127.0.0.1:3000";

const { getMigrations } = await import("better-auth/db/migration");
const { drizzle } = await import("drizzle-orm/node-postgres");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { auth } = await import("../src/lib/auth");
const { pool } = await import("../src/db/client");

const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
// Knowledge base embeddings (recipe ai-agents): pgvector, available on Neon, most managed Postgres and pnpm db:local.
await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
if (existsSync("./drizzle/meta/_journal.json")) {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
}
await pool.end();
console.log("migrations applied");
