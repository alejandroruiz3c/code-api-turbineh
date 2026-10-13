/**
 * Builds the Capability B prompt (AI booking agent, bench/frontiers/spec.md) on staging with the code under test and
 * gets an AI gateway token for that build. The token is written to a private file outside the repository (never
 * printed, never committed); the build summary goes to runs/staging-build-<key>.json.
 *
 *   pnpm --filter @turbineh/bench exec tsx agent-decisions/staging-build.ts --key <idempotency-key> \
 *     [--token-file /tmp/turbineh-agent-decisions-ai-token]
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");
const arg = (n: string, d: string) =>
  process.argv.includes(n) ? (process.argv[process.argv.indexOf(n) + 1] ?? d) : d;
const KEY = arg("--key", "agent-decisions-1");
const TOKEN_FILE = arg("--token-file", "/tmp/turbineh-agent-decisions-ai-token");
const env = readFileSync(join(root, ".env.local"), "utf8");
const token = /^STG_PRODUCT_ACCESS_TOKEN=(.+)$/m.exec(env)?.[1]?.trim();
if (!token) throw new Error("STG_PRODUCT_ACCESS_TOKEN missing in .env.local");
const API = "https://staging.software.turbineh.com";
const headers = {
  Authorization: `Bearer ${token}`,
  "x-turbineh-workspace": "bench-agent-decisions",
  "Content-Type": "application/json",
};

/** Capability B of bench/frontiers/spec.md, verbatim. */
const PROMPT =
  'Build an AI booking assistant for "Flex Physio", a physiotherapy clinic with three physiotherapists and 45-minute ' +
  "sessions (Monday–Friday 09:00–19:00, Europe/Madrid). Patients chat with the assistant in plain language to: check " +
  "availability, book a session with a chosen or any physiotherapist, reschedule, cancel (not later than 24 hours " +
  "before), and ask common questions (prices: first visit 60 €, follow-up 50 €; address; what to bring). The assistant " +
  "must use tools over the clinic's real data (availability, create/move/cancel booking, find booking by email) and " +
  "never invent a slot; it confirms details before booking and sends a confirmation email. Staff sign in to see and " +
  "manage the bookings. The assistant's language model is reached through an OpenAI-compatible endpoint configured by " +
  "environment variables; tests must use a local mock of that endpoint (no internet in tests). Protect it against " +
  "prompt injection and abuse (input limits, rate limits).";

const t0 = Date.now();
const res = await fetch(`${API}/v1/builds`, {
  method: "POST",
  headers: { ...headers, "Idempotency-Key": KEY },
  body: JSON.stringify({ prompt: PROMPT }),
});
const created = (await res.json()) as { build_id?: string; title?: string };
if (!created.build_id) throw new Error(`build not created: ${created.title ?? res.status}`);
const id = created.build_id;
console.log(JSON.stringify({ buildId: id }));
let build: Record<string, unknown> = {};
for (;;) {
  build = (await (await fetch(`${API}/v1/builds/${id}`, { headers })).json()) as Record<
    string,
    unknown
  >;
  if (build.status === "done" || build.status === "failed") break;
  await new Promise((r) => setTimeout(r, 10_000));
}
const m = (build.metrics ?? {}) as Record<string, unknown>;
const handover = (m.handover ?? {}) as Record<string, unknown>;
const summary = {
  buildId: id,
  status: build.status,
  recipe: (build.spec as { recipe?: string } | undefined)?.recipe ?? null,
  wallS: Math.round((Date.now() - t0) / 1000),
  checks: `${String(handover.checksPassed)}/${String(handover.checksTotal)}`,
  timings: m.timings ?? null,
};
const dir = join(import.meta.dirname, "runs");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `staging-build-${KEY}.json`), `${JSON.stringify(summary, null, 2)}\n`);
if (build.status === "done") {
  const t = (await (
    await fetch(`${API}/v1/builds/${id}/ai-token`, { method: "POST", headers })
  ).json()) as { token?: string; title?: string };
  if (t.token) {
    writeFileSync(TOKEN_FILE, t.token, { mode: 0o600 });
    chmodSync(TOKEN_FILE, 0o600);
  }
}
console.log(JSON.stringify(summary));
