/**
 * `pnpm build:local "<prompt>"` — runs the whole pipeline locally (Gate G1) and prints a JSON summary.
 * Build traces go to Postgres (builds + build_events); the repo is written under ./builds/<id>/<slug>.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "@turbineh/db";
import { deciderFromEnv } from "@turbineh/decider";
import { loadLocalEnv, readEnv } from "@turbineh/shared";
import { runBuild } from "./pipeline.js";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  console.error('usage: pnpm build:local "<prompt>"');
  process.exit(2);
}

loadLocalEnv();
const env = readEnv();
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const db = getPool(env.DATABASE_URL);
const created = new Set<string>();

const outcome = await runBuild(prompt, {
  repoRoot,
  buildsDir: join(repoRoot, "builds"),
  decider: deciderFromEnv(env),
  compiler: {
    baseURL: env.COMPILER_BASE_URL,
    model: env.COMPILER_MODEL,
    ...(env.COMPILER_API_KEY ? { apiKey: env.COMPILER_API_KEY } : {}),
    ...(env.MODEL_REASONING_EFFORT ? { reasoningEffort: env.MODEL_REASONING_EFFORT } : {}),
  },
  async emit(buildId, phase, type, data) {
    if (!created.has(buildId)) {
      await db.query("INSERT INTO builds (id, prompt, status) VALUES ($1, $2, 'queued')", [
        buildId,
        prompt,
      ]);
      created.add(buildId);
    }
    await db.query(
      "INSERT INTO build_events (build_id, phase, type, data) VALUES ($1, $2, $3, $4)",
      [buildId, phase, type, data],
    );
    await db.query("UPDATE builds SET status = $2 WHERE id = $1", [buildId, phase]);
    console.error(`[${phase}] ${type}`);
  },
});

await db.query("UPDATE builds SET status = $2, metrics = $3, finished_at = now() WHERE id = $1", [
  outcome.buildId,
  outcome.status,
  outcome.metrics,
]);
const summary = {
  buildId: outcome.buildId,
  status: outcome.status,
  reason: outcome.reason,
  repoDir: outcome.repoDir,
  steps: outcome.verify?.steps.map((s) => ({
    name: s.name,
    ok: s.ok,
    ms: s.ms,
    detail: s.ok ? undefined : s.detail.slice(-1500),
  })),
  metrics: outcome.metrics,
};
const resultsDir = join(repoRoot, "bench/results/runs");
mkdirSync(resultsDir, { recursive: true });
writeFileSync(
  join(resultsDir, `${outcome.buildId}.json`),
  JSON.stringify({ prompt, ...summary }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
await closePool();
