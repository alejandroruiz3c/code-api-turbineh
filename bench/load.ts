/**
 * Load test (PLAN §9 "prueba de carga en D3 antes del freeze"): submits one prompt per recipe at the same time and
 * measures wall-clock time, throughput, green rate and queue depth (from /health) with every worker of the target.
 *
 *   LOAD_API_URL=https://software.turbineh.com pnpm load     production (explicit), key BENCH_API_KEY
 *   pnpm load                                                   staging, key STG_SMOKE_API_KEY
 *   LOAD_COUNT=10 …                                             number of builds (default: one per recipe)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env: Record<string, string> = {};
try {
  for (const l of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
    if (m?.[1]) env[m[1]] = m[2] ?? "";
  }
} catch {
  /* no .env.local */
}
const API = process.env.LOAD_API_URL ?? "https://staging.software.turbineh.com";
const KEY =
  process.env.LOAD_API_KEY ??
  (process.env.LOAD_API_URL ? env.BENCH_API_KEY : env.STG_SMOKE_API_KEY);
if (!KEY) throw new Error("Set LOAD_API_KEY");
const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
      });
      if (res.status < 500 || attempt >= 12) return res;
    } catch (err) {
      if (attempt >= 12) throw err;
    }
    await sleep(Math.min(60_000, 5000 * 2 ** attempt));
  }
}

interface Prompt {
  id: string;
  expected_recipe: string;
  prompt: string;
}
const all = readdirSync(join(root, "bench/prompts"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(root, "bench/prompts", f), "utf8")) as Prompt)
  .sort((a, b) => a.id.localeCompare(b.id));
const perRecipe = [...new Map(all.map((p) => [p.expected_recipe, p])).values()];
const count = Number(process.env.LOAD_COUNT ?? perRecipe.length);
const chosen = Array.from({ length: count }, (_, i) => perRecipe[i % perRecipe.length] as Prompt);
const run = new Date().toISOString();

const t0 = Date.now();
const ids = await Promise.all(
  chosen.map(async (p, i) => {
    const res = await call("/v1/builds", {
      method: "POST",
      headers: { "Idempotency-Key": `load-${run}-${i}` },
      body: JSON.stringify({ prompt: p.prompt }),
    });
    const body = (await res.json()) as { build_id?: string; title?: string };
    return {
      prompt: p.id,
      id: body.build_id ?? null,
      error: body.build_id ? null : (body.title ?? `HTTP ${res.status}`),
    };
  }),
);
console.log(`submitted ${ids.filter((x) => x.id).length}/${count} to ${API}`);

const done = new Map<string, { status: string; s: number }>();
let maxQueued = 0;
let maxWorkers = 0;
while (done.size < ids.filter((x) => x.id).length) {
  const h = (await (await call("/health")).json()) as { queued?: number; workers?: number };
  maxQueued = Math.max(maxQueued, h.queued ?? 0);
  maxWorkers = Math.max(maxWorkers, h.workers ?? 0);
  for (const x of ids) {
    if (!x.id || done.has(x.id)) continue;
    const b = (await (await call(`/v1/builds/${x.id}`)).json()) as { status: string };
    if (b.status === "done" || b.status === "failed") {
      done.set(x.id, { status: b.status, s: Math.round((Date.now() - t0) / 1000) });
      console.log(
        JSON.stringify({
          prompt: x.prompt,
          status: b.status,
          s: Math.round((Date.now() - t0) / 1000),
        }),
      );
    }
  }
  await sleep(10_000);
}
const wall = Math.round((Date.now() - t0) / 1000);
const green = [...done.values()].filter((d) => d.status === "done").length;
const summary = {
  target: API,
  date: run,
  submitted: count,
  accepted: ids.filter((x) => x.id).length,
  rejected: ids.filter((x) => !x.id).map((x) => x.error),
  green,
  wallClockS: wall,
  buildsPerHour: Number(((done.size / wall) * 3600).toFixed(1)),
  maxQueued,
  maxWorkersSeen: maxWorkers,
  notes: [
    "All builds submitted at once; wall clock from first submission to last result.",
    "workers = workers with a heartbeat in the last 90 s (GET /health).",
  ],
};
const stamp = run.slice(0, 16).replace(/[:T]/g, "-");
writeFileSync(
  join(root, "bench/results", `${stamp}-load.json`),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
