/** Creates/updates auth tables (better-auth) and applies app migrations (drizzle). Idempotent. */
import { existsSync } from "node:fs";
import { getMigrations } from "better-auth/db/migration";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { auth } from "../src/lib/auth";
import { pool } from "../src/db/client";

const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
// Knowledge base embeddings (recipe ai-agents): pgvector, available on Neon and most managed Postgres.
await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
if (existsSync("./drizzle/meta/_journal.json")) {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
}
await pool.end();
console.log("migrations applied");
