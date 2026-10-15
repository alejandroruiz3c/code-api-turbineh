/**
 * WP4 smoke test: both Backup Coder slots must answer, and failover must work.
 *   pnpm smoke:backup-coder
 */
import { loadLocalEnv, readEnv } from "@turbineh/shared";
import { backupCoderFromEnv } from "./index.js";

async function main() {
  loadLocalEnv();
  const env = readEnv();
  let coder;
  try {
    coder = backupCoderFromEnv(env);
  } catch (err) {
    console.log(JSON.stringify({ status: "blocked", reason: (err as Error).message }, null, 2));
    process.exitCode = 1;
    return;
  }
  const report: Record<string, unknown> = {
    primary_ref: env.BACKUP_CODER_PRIMARY,
    secondary_ref: env.BACKUP_CODER_SECONDARY,
  };
  for (const slot of ["primary", "secondary"] as const) {
    try {
      report[slot] = { status: "ok", ...(await coder.ping(slot)) };
    } catch (err) {
      report[slot] = { status: "error", error: (err as Error).message };
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

await main();
