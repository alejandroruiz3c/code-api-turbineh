/**
 * Creates an API key for smoke tests and benchmarks in one environment and appends it to .env.local (never printed).
 *
 *   TARGET=staging npx tsx infra/staging/api-key.ts   → STG_SMOKE_API_KEY
 */
import { appendFileSync } from "node:fs";
import { closePool, createApiKey, getPool } from "@turbineh/db";
import { loadLocalEnv } from "@turbineh/shared";

const envFile = loadLocalEnv();
if (!envFile) throw new Error(".env.local not found");
const staging = process.env.TARGET === "staging";
const name = staging ? "STG_SMOKE_API_KEY" : "STAGING_SMOKE_API_KEY";
if (process.env[name]) {
  console.log(`${name} already in .env.local`);
  process.exit(0);
}
const url = process.env[staging ? "STG_DATABASE_URL" : "STAGING_DATABASE_URL"];
if (!url) throw new Error("database URL missing in .env.local");
process.env.DATABASE_CA_CERT = process.env.STAGING_DATABASE_CA_CERT;
const { key } = await createApiKey(getPool(url), "ops:smoke", "smoke and benchmark", 200);
appendFileSync(envFile, `${name}=${key}\n`);
console.log(`${name} written to .env.local`);
await closePool();
