/**
 * Agent-decision bench (ADR-0038): the real runAgent of the orchestrator component, before and after its tool
 * decisions moved to the decider, on the same clinic, tools and conversations.
 *
 *   pnpm --filter @turbineh/bench exec tsx agent-decisions/run.ts \
 *     --ref worktree|origin/main --target mock|staging --set actions|conversations [--limit 20] [--parallel 2] \
 *     [--model gemma-4-26b-a4b-it] [--token-file /tmp/turbineh-frontiers-ai-token] [--label name]
 *
 * --target staging: the TurbineH AI gateway on staging with an app token read from a private file (never printed).
 * --target mock: the component's scripted mock model + decider (tests/mock-llm) — plumbing, calls and tokens only.
 * Success is checked deterministically (clinic state, labelled first action), never by a model. Every request is
 * metered at the HTTP layer, so model and decider tokens are counted separately whatever the code version does.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startMockLlm } from "../../catalog/components/ai.orchestrator.turbineh/files/tests/mock-llm/mock";
import {
  ACTION_CASES,
  Clinic,
  clinicTools,
  conversations,
  MOCK_SCRIPT,
  POLICY,
  subset,
} from "./clinic";
import { loadRuntime } from "./runtime";

const arg = (n: string, d: string) =>
  process.argv.includes(n) ? (process.argv[process.argv.indexOf(n) + 1] ?? d) : d;
const REF = arg("--ref", "worktree");
const TARGET = arg("--target", "mock") as "mock" | "staging";
const SET = arg("--set", "actions") as "actions" | "conversations";
const LIMIT = Number(arg("--limit", "20"));
const PARALLEL = Number(arg("--parallel", "2"));
const MODEL = arg("--model", TARGET === "mock" ? "mock" : "gemma-4-26b-a4b-it");
const GATEWAY = arg("--gateway", "https://staging.software.turbineh.com/v1/ai");
const TOKEN_FILE = arg("--token-file", "/tmp/turbineh-frontiers-ai-token");
const LABEL = arg("--label", `${SET}-${TARGET}-${REF.replace(/[^a-z0-9]+/gi, "-")}`);

/** List prices [est.]: open model (provider list price, EUR→USD 1.08) and decider (upper bound of the documented
 * range), the same constants as bench/frontiers/brain.ts. */
const PRICE = { input: 0.25 * 1.08, output: 0.5 * 1.08, decider: 0.42 };

interface Meter {
  modelCalls: number;
  modelIn: number;
  modelOut: number;
  deciderCalls: number;
  deciderTokens: number;
  deciderErrors: number;
  /** Next-action decisions at or above runAgent's threshold (followed) and below it (left to the model). */
  nextFollowed: number;
  nextLow: number;
  waitMs: number;
}
const newMeter = (): Meter => ({
  modelCalls: 0,
  modelIn: 0,
  modelOut: 0,
  deciderCalls: 0,
  deciderTokens: 0,
  deciderErrors: 0,
  nextFollowed: 0,
  nextLow: 0,
  waitMs: 0,
});
const costOf = (m: Meter) =>
  (m.modelIn * PRICE.input + m.modelOut * PRICE.output + m.deciderTokens * PRICE.decider) / 1e6;

// HTTP metering (and transparent 429 back-off, excluded from latency) per case.
const current = new AsyncLocalStorage<Meter>();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = current.getStore();
  for (let attempt = 0; ; attempt++) {
    const res = await realFetch(input, init);
    if (res.status === 429 && attempt < 6) {
      const wait = 4000 * (attempt + 1);
      if (m) m.waitMs += wait;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (m) {
      const body = (await res
        .clone()
        .json()
        .catch(() => ({}))) as {
        usage?: Record<string, number | undefined>;
        answers?: { next?: { confidence?: number } };
      };
      const u = body.usage ?? {};
      if (url.endsWith("/systemone")) {
        m.deciderCalls++;
        if (!res.ok) m.deciderErrors++;
        m.deciderTokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
        const next = body.answers?.next;
        if (next) {
          if ((next.confidence ?? 0) >= 0.5) m.nextFollowed++;
          else m.nextLow++;
        }
      } else if (url.endsWith("/chat/completions")) {
        m.modelCalls++;
        m.modelIn += u.prompt_tokens ?? 0;
        m.modelOut += u.completion_tokens ?? 0;
      }
    }
    return res;
  }
};

async function main() {
  let stop = () => undefined as void;
  if (TARGET === "mock") {
    const mock = await startMockLlm([MOCK_SCRIPT]);
    process.env.TURBINEH_AI_URL = mock.url;
    process.env.TURBINEH_AI_TOKEN = "mock-token";
    process.env.AI_BASE_URL = `${mock.url}/v1`;
    stop = () => void mock.server.close();
  } else {
    process.env.TURBINEH_AI_URL = GATEWAY;
    process.env.TURBINEH_AI_TOKEN = readFileSync(TOKEN_FILE, "utf8").trim();
    delete process.env.AI_BASE_URL;
  }
  // Every route on the same model, so both versions are compared on one model.
  process.env.AI_ROUTES = `fast=${MODEL},balanced=${MODEL},frontier=${MODEL}`;
  delete process.env.AI_MODEL;

  const { agent } = await loadRuntime(REF);
  const base = { organizationId: "bench", userId: null, purpose: "bench", instructions: POLICY };
  const now = new Date("2026-10-14T08:00:00Z");

  type Row = Record<string, unknown> & { ok: boolean; ms: number[]; meter: Meter };
  const rows: Row[] = [];
  const runOne = async (job: () => Promise<Omit<Row, "meter">>) => {
    const meter = newMeter();
    const r = await current.run(meter, job);
    rows.push({ ...r, meter });
  };

  const jobs: (() => Promise<void>)[] = [];
  if (SET === "actions") {
    for (const c of ACTION_CASES.slice(0, LIMIT))
      jobs.push(() =>
        runOne(async () => {
          const clinic = new Clinic();
          const t0 = performance.now();
          let first = "error";
          let error: string | null = null;
          try {
            const r = await agent.runAgent({
              ...base,
              input: c.message,
              tools: clinicTools(clinic, agent.ToolError),
              now,
              maxSteps: 1,
            });
            first = r.steps[0]?.tool ?? "reply";
          } catch (e) {
            error = String(e).slice(0, 200);
          }
          const m = current.getStore() as Meter;
          return {
            id: c.id,
            expected: c.expected,
            got: first,
            ok: c.expected.includes(first),
            ms: [performance.now() - t0 - m.waitMs],
            error,
          };
        }),
      );
  } else {
    for (const c of subset(conversations(), LIMIT))
      jobs.push(() =>
        runOne(async () => {
          const clinic = new Clinic();
          c.setup?.(clinic);
          const tools = clinicTools(clinic, agent.ToolError);
          const replies: string[] = [];
          const ms: number[] = [];
          const steps: string[] = [];
          let state: unknown = null;
          let pending = false;
          let error: string | null = null;
          const m = current.getStore() as Meter;
          for (const turn of c.turns) {
            const t0 = performance.now();
            const w0 = m.waitMs;
            try {
              // A confirmation turn presses the widget's confirm button when an action is pending.
              const confirm =
                pending && /\b(yes|go ahead|confirm|book it|move it|cancel it)\b/i.test(turn)
                  ? { confirm: true }
                  : {};
              const r = await agent.runAgent({
                ...base,
                input: turn,
                tools,
                state,
                now,
                ...confirm,
              });
              state = r.state;
              pending = r.status === "needs_confirmation";
              replies.push(r.reply);
              steps.push(...r.steps.map((s) => `${s.tool}${s.executed ? "" : "?"}`));
            } catch (e) {
              const msg = String(e).slice(0, 200);
              replies.push(msg);
              if (!/can't be processed/.test(msg)) error = msg;
            }
            ms.push(performance.now() - t0 - (m.waitMs - w0));
          }
          return {
            id: c.id,
            kind: c.kind,
            ok: !error && c.check(clinic, replies),
            ms,
            steps,
            error,
            replies: replies.map((r) => r.slice(0, 200)),
          };
        }),
      );
  }

  const t0 = Date.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, jobs.length) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        if (job) await job();
      }
    }),
  );
  stop();

  const ms = rows.flatMap((r) => r.ms).sort((a, b) => a - b);
  const pct = (p: number) =>
    Math.round(ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] ?? 0);
  const total = rows.reduce((acc, r) => {
    for (const k of Object.keys(acc) as (keyof Meter)[]) acc[k] += r.meter[k];
    return acc;
  }, newMeter());
  const summary = {
    label: LABEL,
    ref: REF,
    target: TARGET,
    set: SET,
    model: MODEL,
    date: new Date().toISOString(),
    cases: rows.length,
    accuracy: rows.filter((r) => r.ok).length / Math.max(rows.length, 1),
    passed: `${rows.filter((r) => r.ok).length}/${rows.length}`,
    latencyMs: {
      perTurn: {
        p50: pct(0.5),
        p95: pct(0.95),
        mean: Math.round(ms.reduce((a, b) => a + b, 0) / Math.max(ms.length, 1)),
      },
    },
    calls: {
      model: total.modelCalls,
      decider: total.deciderCalls,
      deciderErrors: total.deciderErrors,
      nextFollowed: total.nextFollowed,
      nextLeftToModel: total.nextLow,
    },
    tokens: {
      modelInput: total.modelIn,
      modelOutput: total.modelOut,
      decider: total.deciderTokens,
    },
    costUsd: Number(costOf(total).toFixed(5)),
    costPer1000CasesUsd: Number(((costOf(total) / Math.max(rows.length, 1)) * 1000).toFixed(3)),
    prices: PRICE,
    wallS: Math.round((Date.now() - t0) / 1000),
  };
  const dir = join(import.meta.dirname, "runs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${LABEL}.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ summary, rows: rows.sort((a, b) => String(a.id).localeCompare(String(b.id))) }, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary));
  const failed = rows
    .filter((r) => !r.ok)
    .map((r) => `${String(r.id)}:${String(r.got ?? r.error ?? "")}`);
  if (failed.length) console.log("failed:", failed.join(" ").slice(0, 600));
}

main().catch((e: unknown) => {
  console.error(String(e).slice(0, 500));
  process.exit(1);
});
