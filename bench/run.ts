/**
 * Benchmark runner (PLAN §12, WP16). Sends every prompt in bench/prompts/ to the public API (staging by default),
 * one at a time, waits for the result and writes a JSON + Markdown report to bench/results/.
 *
 *   pnpm bench                      # staging (ADR-0022), API key from BENCH_API_KEY or STG_SMOKE_API_KEY in .env.local
 *   pnpm bench -- --only saas-01    # one prompt
 *
 * Only numbers measured here may be published (CLAUDE.md, "Métricas").
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const env: Record<string, string> = {};
if (existsSync(join(root, ".env.local"))) {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1]) env[m[1]] = m[2] ?? "";
  }
}
const API = process.env.BENCH_API_URL ?? "https://staging.software.turbineh.com";
// Keys belong to one environment: the staging smoke key by default, the production keys only with BENCH_API_URL.
const KEY =
  process.env.BENCH_API_KEY ??
  (process.env.BENCH_API_URL
    ? (env.BENCH_API_KEY ?? env.STAGING_SMOKE_API_KEY)
    : env.STG_SMOKE_API_KEY);
if (!KEY) throw new Error("Set BENCH_API_KEY (or STG_SMOKE_API_KEY in .env.local)");
const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : null;

/** €/1M tokens (input, output), Scaleway Generative APIs, knowledge/modelos-ia/03-guias-transversales [oficial]. */
const PRICE: Record<string, [number, number]> = {
  "gemma-4-26b-a4b-it": [0.25, 0.5],
  "deepseek-v4-flash-0731": [0.4, 0.8],
  "glm-5.2": [1.8, 5.5],
};

interface Usage {
  input_tokens: number;
  output_tokens: number;
}
interface Prompt {
  id: string;
  expected_recipe: string;
  prompt: string;
}

const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const get = async (path: string) =>
  (await fetch(`${API}${path}`, { headers })).json() as Promise<Record<string, unknown>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runOne(p: Prompt) {
  const t0 = Date.now();
  const res = await fetch(`${API}/v1/builds`, {
    method: "POST",
    headers: {
      ...headers,
      "Idempotency-Key": `bench-${p.id}-${new Date().toISOString().slice(0, 13)}`,
    },
    body: JSON.stringify({ prompt: p.prompt }),
  });
  const created = (await res.json()) as { build_id?: string; title?: string };
  if (!created.build_id) return { id: p.id, error: created.title ?? `HTTP ${res.status}` };
  let b: Record<string, unknown> = {};
  for (;;) {
    b = await get(`/v1/builds/${created.build_id}`);
    if (b.status === "done" || b.status === "failed") break;
    await sleep(5000);
  }
  return summarize(p, created.build_id, b, Date.now() - t0);
}

function summarize(p: Prompt, buildId: string, b: Record<string, unknown>, wallMs: number) {
  const m = (b.metrics ?? {}) as Record<string, any>;
  const add = (a: Usage, u?: Usage) => ({
    input_tokens: a.input_tokens + (u?.input_tokens ?? 0),
    output_tokens: a.output_tokens + (u?.output_tokens ?? 0),
  });
  const zero: Usage = { input_tokens: 0, output_tokens: 0 };
  const compiler: Usage = m.tokens?.compiler ?? zero;
  const glue = ((m.integrated ?? []) as { usage: Usage }[]).reduce((a, i) => add(a, i.usage), zero);
  const backup = ((m.backup?.activations ?? []) as { usage: Usage }[]).reduce(
    (a, x) => add(a, x.usage),
    zero,
  );
  const corrections = (m.corrections ?? []) as { usage: Usage; by: string }[];
  const correctionUsage = corrections.reduce((a, c) => add(a, c.usage), zero);
  const eur = (u: Usage, model: string) => {
    const [i, o] = PRICE[model] ?? [0, 0];
    return (u.input_tokens * i + u.output_tokens * o) / 1e6;
  };
  const backupEur = ((m.backup?.activations ?? []) as { usage: Usage; model: string }[]).reduce(
    (a, x) => a + eur(x.usage, x.model),
    0,
  );
  const correctionEur = corrections.reduce((a, c) => a + eur(c.usage, c.by), 0);
  const criteria = (m.report?.criteria ?? []) as { verified: boolean }[];
  return {
    id: p.id,
    buildId,
    status: b.status as string,
    reason: (b.error as string | null) ?? null,
    recipe: { expected: p.expected_recipe, built: m.recipe?.built ?? null },
    timeToResultS: Math.round((m.timings?.total ?? wallMs) / 1000),
    wallS: Math.round(wallMs / 1000),
    verifyS: Math.round((m.timings?.verify ?? 0) / 1000),
    criteria: { verified: criteria.filter((c) => c.verified).length, total: criteria.length },
    reuse: {
      reusedShare: m.reuse?.reusedShare ?? null,
      generatedLines: m.reuse?.generatedLines ?? null,
      reusedLines: m.reuse?.reusedLines ?? null,
    },
    components: (m.components ?? []).length,
    integrated: (m.integrated ?? []).length,
    backupActivations: ((m.backup?.activations ?? []) as { trigger: string; kept?: boolean }[]).map(
      (a) => `${a.trigger}${a.kept === false ? " (removed)" : ""}`,
    ),
    compilerBackup: m.compilerBackup?.trigger ?? null,
    corrections: corrections.length,
    swappedOut: (m.swappedOut ?? []).length,
    securityFixed: (m.remediation ?? []).length,
    alerts: (m.alerts ?? []).length,
    tokens: {
      compiler,
      glue,
      backup,
      corrections: correctionUsage,
      backupShare: +(
        (backup.input_tokens + backup.output_tokens) /
        Math.max(
          1,
          compiler.input_tokens +
            compiler.output_tokens +
            glue.input_tokens +
            glue.output_tokens +
            backup.input_tokens +
            backup.output_tokens +
            correctionUsage.input_tokens +
            correctionUsage.output_tokens,
        )
      ).toFixed(3),
    },
    costEur: +(
      eur(compiler, "gemma-4-26b-a4b-it") +
      eur(glue, "gemma-4-26b-a4b-it") +
      backupEur +
      correctionEur
    ).toFixed(5),
  };
}

const prompts = readdirSync(join(root, "bench/prompts"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(root, "bench/prompts", f), "utf8")) as Prompt)
  .filter((p) => !only || p.id === only)
  .sort((a, b) => a.id.localeCompare(b.id));

const results: Awaited<ReturnType<typeof runOne>>[] = [];
for (const p of prompts) {
  const r = await runOne(p);
  results.push(r);
  console.log(
    JSON.stringify({
      id: p.id,
      status: "status" in r ? r.status : "error",
      t: "timeToResultS" in r ? r.timeToResultS : null,
    }),
  );
}

const ok = results.filter((r): r is ReturnType<typeof summarize> => "status" in r);
const green = ok.filter((r) => r.status === "done");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const summary = {
  target: API,
  date: new Date().toISOString(),
  prompts: results.length,
  green: green.length,
  avgTimeToResultS: Math.round(avg(green.map((r) => r.timeToResultS))),
  avgVerifyS: Math.round(avg(green.map((r) => r.verifyS))),
  criteriaVerified: `${ok.reduce((a, r) => a + r.criteria.verified, 0)}/${ok.reduce((a, r) => a + r.criteria.total, 0)}`,
  avgReusedShare: +avg(green.map((r) => r.reuse.reusedShare ?? 0)).toFixed(3),
  buildsWithBackup: ok.filter((r) => r.backupActivations.length > 0 || r.compilerBackup).length,
  // T3: business-rule modules written by the Backup Coder, and how many survived verification.
  businessRules: {
    written: ok.reduce(
      (a, r) => a + r.backupActivations.filter((x) => x.startsWith("T3")).length,
      0,
    ),
    kept: ok.reduce((a, r) => a + r.backupActivations.filter((x) => x === "T3").length, 0),
  },
  avgCorrections: +avg(ok.map((r) => r.corrections)).toFixed(2),
  avgCostEur: +avg(ok.map((r) => r.costEur)).toFixed(5),
  avgTokens: Math.round(
    avg(
      ok.map((r) =>
        Object.values(r.tokens)
          .filter((x): x is Usage => typeof x === "object")
          .reduce((a, u) => a + u.input_tokens + u.output_tokens, 0),
      ),
    ),
  ),
  notes: [
    "Cost [est.]: tracked tokens × Scaleway list prices (compiler, glue, Backup Coder, corrections). Not included: decider (JEV) requests, security fixer and report writer calls, embeddings, sandbox compute.",
    "Time to result: pipeline time reported by the worker (excludes queue wait).",
  ],
};
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
writeFileSync(
  join(root, `bench/results/${stamp}-benchmark.json`),
  JSON.stringify({ summary, results }, null, 2) + "\n",
);
const rows = ok
  .map(
    (r) =>
      `| ${r.id} | ${r.status === "done" ? "✅" : "❌"} | ${r.recipe.built ?? "—"} | ${r.timeToResultS}s | ${r.criteria.verified}/${r.criteria.total} | ${r.reuse.reusedShare ?? "—"} | ${r.integrated} | ${r.backupActivations.join(", ") || "—"} | ${r.corrections} | ${r.securityFixed} | ${r.alerts} | ${r.costEur} |`,
  )
  .join("\n");
writeFileSync(
  join(root, `bench/results/${stamp}-benchmark.md`),
  `# Benchmark · ${summary.date.slice(0, 10)} · ${API}

Green builds: **${summary.green}/${summary.prompts}** · avg time to result ${summary.avgTimeToResultS}s (verification ${summary.avgVerifyS}s) · criteria verified ${summary.criteriaVerified} · avg reused share ${summary.avgReusedShare} · builds using the Backup Coder ${summary.buildsWithBackup} · avg corrections ${summary.avgCorrections} · avg tracked model cost €${summary.avgCostEur} [est.] · avg tracked tokens ${summary.avgTokens}

| Prompt | Green | Recipe | Time | Criteria verified | Reused share | Integrated | Backup Coder | Corrections | Security fixes | Alerts | Model cost € [est.] |
|---|---|---|---|---|---|---|---|---|---|---|---|
${rows}

${summary.notes.map((n) => `- ${n}`).join("\n")}
`,
);
console.log(JSON.stringify(summary, null, 2));
