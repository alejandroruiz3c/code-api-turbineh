/**
 * Owner query (ADR-0052): requests the library does not cover yet, newest first, with the missing requirements and
 * whether the person is subscribed to the priority notification.
 *
 *   pnpm --filter @turbineh/db demand [limit] [--json]
 *
 * Reads DATABASE_URL from the environment (.env.local). Contact data stays in this terminal: never paste it in public.
 */
import { loadLocalEnv, readEnv } from "@turbineh/shared";
import { closePool, getPool } from "./client.js";
import { listDemand } from "./demand.js";

loadLocalEnv();
const args = process.argv.slice(2);
const limit = Number(args.find((a) => /^\d+$/.test(a)) ?? 100);
const rows = await listDemand(getPool(readEnv().DATABASE_URL), limit);
if (args.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else if (rows.length === 0) {
  console.log("No uncovered requests recorded.");
} else {
  for (const r of rows) {
    console.log(
      `${new Date(r.created_at).toISOString()} · ${r.status} · ${r.owner_id ?? "—"} · ${r.email ?? "no email"}${r.subscribed ? " · subscribed" : ""}`,
    );
    console.log(`  request: ${r.request.replace(/\s+/g, " ").slice(0, 200)}`);
    for (const m of r.missing) console.log(`  - ${m.requirement} (${m.why})`);
  }
}
await closePool();
