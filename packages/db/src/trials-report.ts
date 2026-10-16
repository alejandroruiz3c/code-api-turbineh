/**
 * Owner query (ADR-0059): Intelligence Orchestration trial accounts, newest first, with their spend.
 *
 *   pnpm --filter @turbineh/db trials [limit] [--json]
 *
 * Reads DATABASE_URL from the environment (.env.local). Contact data stays in this terminal: never paste it in public.
 */
import { loadLocalEnv, readEnv } from "@turbineh/shared";
import { closePool, getPool } from "./client.js";
import { listOrchestrationTrials } from "./orchestration-trials.js";

loadLocalEnv();
const args = process.argv.slice(2);
const limit = Number(args.find((a) => /^\d+$/.test(a)) ?? 100);
const rows = await listOrchestrationTrials(getPool(readEnv().DATABASE_URL), limit);
if (args.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else if (rows.length === 0) {
  console.log("No orchestration trials yet.");
} else {
  for (const r of rows) {
    console.log(
      `${new Date(r.created_at).toISOString()} · ${r.email} · ${r.name}${r.company ? ` (${r.company})` : ""} · $${r.spent_usd.toFixed(4)} spent · ${r.signups} signup(s) · token ${r.active_prefix ?? "none"}`,
    );
    if (r.use_case) console.log(`  use case: ${r.use_case.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}
await closePool();
