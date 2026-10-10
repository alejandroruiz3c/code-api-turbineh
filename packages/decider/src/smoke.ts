/**
 * WP2 smoke test: each available backend answers 1 Choice + 1 Noul in ONE request.
 * Measures latency over N runs (after one warm-up) and prints a JSON report.
 *
 *   pnpm smoke:decider            # uses .env.local
 */
import { loadLocalEnv, percentile, readEnv } from "@turbineh/shared";
import { choice, createJevDecider, createOpenDecider, noul, type Decider } from "./index.js";

const RUNS = Number(process.env.SMOKE_RUNS ?? 10);

const state = {
  build_spec: { recipe: "saas-crud", capability: "auth.session", stack: "next.js app router" },
  candidates: {
    "auth.session.better-auth":
      "Cookie sessions with rotation, email/password and OAuth, Drizzle adapter",
    "auth.session.lucia-pattern":
      "Hand-rolled session tables following the Lucia guide, no OAuth helpers",
    "auth.session.next-auth": "Auth.js for Next.js, OAuth-first, JWT or database sessions",
  },
};

const questions = {
  best_fit: choice(
    "Which candidate best provides `build_spec.capability` for `build_spec.stack`?",
    {
      "auth.session.better-auth": null,
      "auth.session.lucia-pattern": null,
      "auth.session.next-auth": null,
    },
  ),
  needs_oauth_helpers: noul(
    "The capability in `build_spec` requires built-in OAuth provider helpers.",
  ),
};

async function run(decider: Decider) {
  await decider.ask(state, questions); // warm-up (not measured)
  const latencies: number[] = [];
  let last;
  for (let i = 0; i < RUNS; i++) {
    last = await decider.ask(state, questions);
    latencies.push(last.meta.latencyMs);
  }
  return {
    backend: decider.id,
    model: last?.meta.model,
    runs: RUNS,
    requests_per_ask: last?.meta.requests,
    latency_ms: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: Math.max(...latencies),
    },
    usage_last: last?.meta.usage,
    answers_last: last?.answers,
  };
}

async function main() {
  loadLocalEnv();
  const env = readEnv();
  const report: Record<string, unknown> = { date: new Date().toISOString() };
  const targets: Array<[string, () => Decider | undefined]> = [
    ["jev", () => (env.TYPESAFE_API_KEY ? createJevDecider(env.TYPESAFE_API_KEY) : undefined)],
    [
      "open",
      () => (env.OPEN_DECIDER_BASE_URL ? createOpenDecider(env.OPEN_DECIDER_BASE_URL) : undefined),
    ],
  ];
  for (const [name, make] of targets) {
    const decider = make();
    if (!decider) {
      report[name] = { status: "skipped", reason: "not configured" };
      continue;
    }
    try {
      report[name] = { status: "ok", ...(await run(decider)) };
    } catch (err) {
      report[name] = { status: "error", error: err instanceof Error ? err.message : String(err) };
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

await main();
