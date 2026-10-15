/**
 * Owner command (ADR-0056): tell the people on the priority list that what they asked for is available now.
 *
 *   pnpm --filter @turbineh/db notify-available <demand ids…>            dry run: who would be emailed
 *   pnpm --filter @turbineh/db notify-available --capability <text>      use case id, or text in a missing requirement
 *   … --send [--message "What is new, in one sentence"]                   actually email and mark the rows notified
 *
 * Demand ids come from `pnpm --filter @turbineh/db demand`. One email per address; each row is told once
 * (`available_notified_at`). Reads DATABASE_URL and RESEND_API_KEY (+ EMAIL_FROM) from the environment (.env.local).
 * Contact data stays in this terminal: never paste it in public.
 */
import { fileURLToPath } from "node:url";
import { createLogger, loadLocalEnv, mailerFromEnv, readEnv } from "@turbineh/shared";
import { closePool, getPool } from "./client.js";
import { findAvailableTargets, notifyAvailable, type AvailableTarget } from "./demand-email.js";

export function parseArgs(argv: string[]): AvailableTarget & { send: boolean; message?: string } {
  const out: AvailableTarget & { send: boolean; message?: string } = { send: false, ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--") continue;
    if (a === "--send") out.send = true;
    else if (a === "--capability") out.capability = argv[++i] ?? "";
    else if (a === "--message") out.message = argv[++i] ?? "";
    else if (/^\d+(,\d+)*$/.test(a)) out.ids?.push(...a.split(",").map(Number));
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.ids?.length && !args.capability) {
    console.log(
      "usage: notify-available <demand ids…> | --capability <text>  [--send] [--message <text>]",
    );
    process.exitCode = 2;
    return;
  }
  const db = getPool(readEnv().DATABASE_URL);
  try {
    if (!args.send) {
      const rows = await findAvailableTargets(db, args);
      if (!rows.length) console.log("No pending demand matches.");
      for (const r of rows)
        console.log(
          `#${r.id} · ${r.email ?? "no email"} · ${r.request.replace(/\s+/g, " ").slice(0, 120)}`,
        );
      console.log(
        `\nDry run: ${rows.length} row(s). Add --send to email them and mark them notified.`,
      );
      return;
    }
    const mailer = mailerFromEnv();
    if (!mailer) {
      console.log("RESEND_API_KEY is not set: nothing sent.");
      process.exitCode = 1;
      return;
    }
    const r = await notifyAvailable(db, mailer, args, {
      ...(args.message ? { message: args.message } : {}),
      log: createLogger("notify-available"),
    });
    console.log(
      `matched ${r.matched} · emailed ${r.emailed.length} address(es) · failed ${r.failed} · without email ${r.withoutEmail.length}`,
    );
    for (const e of r.emailed) console.log(`  sent: ${e}`);
    if (r.withoutEmail.length)
      console.log(`  no email (not marked): #${r.withoutEmail.join(", #")}`);
  } finally {
    await closePool();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
