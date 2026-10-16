/**
 * Go-validation benchmark runner (audit report v2, section 9). For each statement of statements.json it runs the
 * public flow — POST /v1/plans → (approve when the plan asks) → POST /v1/plans/{id}/generate → wait — and stores the
 * raw answers of every surface (plan, result, /v1/builds, manifest.json, turbineh.json) in runs/<run>/<id>.json.
 * It also measures Discover precision@5 (discover-queries.json) and reads snippet compilation when the catalogue
 * exposes it. Scoring is separate (report.ts), so a run is re-scored after a person reviews it, without rebuilding.
 *
 *   tsx bench/validation/run.ts --env staging --only A01,B01,C01      # dry run of 3 statements
 *   tsx bench/validation/run.ts --env staging                         # all 30
 *   tsx bench/validation/run.ts --env production --yes-production     # the go benchmark (explicit)
 *   VALIDATION_RUN=2026-10-16-staging tsx bench/validation/run.ts …    # resume: finished statements are kept,
 *                                                                      # flows in progress are picked up again
 *   Options: --band A|B|C · --concurrency 1..3 (default 3) · --no-discover · --no-generate (plan only)
 *            --generate-offers (also generate band C components-only offers) · --env-file <path>
 *
 * Keys come from .env.local by label (never printed): STG_SMOKE_API_KEY for staging, STAGING_SMOKE_API_KEY for
 * production; VALIDATION_API_KEY overrides both. Only numbers measured here may be published (CLAUDE.md, "Métricas").
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Statement, StatementRun } from "./metrics.ts";
import { precisionAt5 } from "./metrics.ts";

const here = import.meta.dirname;
const root = join(here, "../..");
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string): string | undefined =>
  argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined;

const ENVS = {
  staging: { url: "https://staging.software.turbineh.com", key: "STG_SMOKE_API_KEY" },
  production: { url: "https://software.turbineh.com", key: "STAGING_SMOKE_API_KEY" },
} as const;
const envName = (opt("--env") ?? "staging") as keyof typeof ENVS;
if (!(envName in ENVS)) throw new Error("--env must be staging or production");
if (envName === "production" && !flag("--yes-production"))
  throw new Error("Running against production needs --yes-production (it creates real flows).");

function readEnvFile(): Record<string, string> {
  const candidates = [
    opt("--env-file"),
    process.env.TURBINEH_ENV_FILE,
    join(root, ".env.local"),
  ].filter((x): x is string => Boolean(x));
  const out: Record<string, string> = {};
  for (const f of candidates) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m?.[1]) out[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
    }
    break;
  }
  return out;
}
const API = process.env.VALIDATION_API_URL ?? ENVS[envName].url;
const KEY = process.env.VALIDATION_API_KEY ?? readEnvFile()[ENVS[envName].key];
if (!KEY) throw new Error(`Set ${ENVS[envName].key} in .env.local (or VALIDATION_API_KEY)`);

const RUN = process.env.VALIDATION_RUN ?? `${new Date().toISOString().slice(0, 10)}-${envName}`;
const runDir = join(here, "runs", RUN);
mkdirSync(runDir, { recursive: true });
const CONCURRENCY = Math.min(3, Math.max(1, Number(opt("--concurrency") ?? 3) || 3));
const POLL_MS = 10_000;
const GENERATE_TIMEOUT_MS = 90 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

/** Network errors and 5xx are retried with backoff (about 10 minutes); flows keep running server-side. */
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      });
      if (res.status < 500 || attempt >= 10) return res;
    } catch (err) {
      if (attempt >= 10) throw err;
    }
    await sleep(Math.min(60_000, 3000 * 2 ** attempt));
  }
}
async function json(res: Response): Promise<Record<string, unknown> | null> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

/** Runs are committed: short-lived signed download URLs are dropped (they grant access to the package while valid). */
const unsigned = (_k: string, v: unknown) =>
  typeof v === "string" && /[?&](X-Amz-Signature|X-Amz-Credential|Signature|sig|token)=/i.test(v)
    ? "[signed URL removed]"
    : v;

const TERMINAL_WAITING = new Set(["planning", "planned", "generating"]);

/** turbineh.json of the delivered app: the app ZIP is read in a temporary folder and deleted (never committed). */
async function fetchGuide(id: string): Promise<Record<string, unknown> | null> {
  const res = await call(`/v1/plans/${id}/package?format=app`);
  if (!res.ok) return null;
  const dir = mkdtempSync(join(tmpdir(), "turbineh-validation-"));
  try {
    const zip = join(dir, "app.zip");
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const entries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n");
    const entry = entries
      .filter((e) => /(^|\/)turbineh\.json$/.test(e) && !e.includes("node_modules"))
      .sort((a, b) => a.split("/").length - b.split("/").length)[0];
    if (!entry) return null;
    return JSON.parse(
      execFileSync("unzip", ["-p", zip, entry], { encoding: "utf8", maxBuffer: 64 << 20 }),
    ) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function fetchManifest(id: string): Promise<Record<string, unknown> | null> {
  const res = await call(`/v1/plans/${id}/package?format=manifest`);
  return res.ok ? json(res) : null;
}

async function runStatement(s: Statement): Promise<StatementRun> {
  const file = join(runDir, `${s.id}.json`);
  const previous = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as StatementRun)
    : null;
  if (previous?.phase === "done") return previous;
  const t0 = Date.now();
  const rec: StatementRun = {
    id: s.id,
    band: s.band,
    env: envName,
    api: API,
    runId: RUN,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    phase: "error",
    error: null,
    flowId: null,
    plan: null,
    approved: null,
    generate: null,
    final: null,
    build: null,
    manifest: null,
    guide: null,
    timings: { planMs: null, generateMs: null, wallMs: 0 },
  };
  const save = () => {
    rec.timings.wallMs = Date.now() - t0;
    writeFileSync(file, `${JSON.stringify(rec, unsigned, 2)}\n`);
  };
  try {
    // 1 · Plan (same idempotency key on resume: the flow already created is returned, never a second one).
    const res = await call("/v1/plans", {
      method: "POST",
      headers: { "Idempotency-Key": `validation-${RUN}-${s.id}` },
      body: JSON.stringify({ need: s.prompt, environment: {} }),
    });
    const body = await json(res);
    rec.plan = {
      httpStatus: res.status,
      problem: res.ok ? null : body,
      body: res.ok ? body : null,
      ms: Date.now() - t0,
    };
    const id = typeof body?.id === "string" ? body.id : null;
    rec.flowId = id;
    if (!res.ok || !id) {
      rec.timings.planMs = Date.now() - t0;
      // A refusal (use_case_not_covered) is a measured outcome, not an error.
      rec.phase = res.status === 422 ? "done" : "error";
      if (rec.phase === "error") rec.error = `POST /v1/plans → ${res.status}`;
      return rec;
    }
    let plan = body as Record<string, unknown>;
    while (plan.state === "planning") {
      await sleep(3000);
      plan = (await json(await call(`/v1/plans/${id}`))) ?? {};
      if (plan.state === "failed") {
        rec.plan.problem = (
          (plan.result as Record<string, unknown> | undefined)?.errors as
            Record<string, unknown>[] | undefined
        )?.[0] ?? { code: "failed" };
        break;
      }
    }
    rec.plan.body = plan;
    rec.timings.planMs = Date.now() - t0;
    save();
    if (plan.state === "failed") {
      rec.phase = "done";
      return rec;
    }

    // 2 · Generate: bands A and B always; band C only with --generate-offers (its offer is recorded either way).
    const resultState = String(
      (plan.result as Record<string, unknown> | undefined)?.state ?? plan.state,
    );
    const generateIt = !flag("--no-generate") && (s.band !== "C" || flag("--generate-offers"));
    if (generateIt && resultState === "planned") {
      const needs = (plan.needsApproval as string[] | undefined) ?? [];
      if (needs.length) rec.approved = needs;
      const g = await call(`/v1/plans/${id}/generate`, {
        method: "POST",
        body: JSON.stringify(needs.length ? { approve: true } : {}),
      });
      rec.generate = { httpStatus: g.status, body: await json(g) };
      save();
    }
    const tGen = Date.now();
    let final = (await json(await call(`/v1/plans/${id}`))) ?? {};
    const stateNow = () => String((final.result as Record<string, unknown> | undefined)?.state);
    const generating = () => TERMINAL_WAITING.has(stateNow());
    // Resumed run: the flow was already sent to generation by the interrupted run.
    if (!rec.generate && stateNow() !== "planned" && stateNow() !== "failed")
      rec.generate = { httpStatus: 0, body: { resumed: true, state: stateNow() } };
    if (rec.generate && rec.generate.httpStatus < 300) {
      while (generating() && Date.now() - tGen < GENERATE_TIMEOUT_MS) {
        await sleep(POLL_MS);
        final = (await json(await call(`/v1/plans/${id}`))) ?? final;
      }
      rec.timings.generateMs = Date.now() - tGen;
      if (generating()) rec.error = "generation did not finish within 90 minutes";
    }
    rec.final = final;
    rec.build = await json(await call(`/v1/builds/${id}`));
    if (rec.generate && rec.generate.httpStatus < 300) {
      rec.manifest = await fetchManifest(id);
      rec.guide = await fetchGuide(id);
    }
    rec.phase = rec.error ? "error" : "done";
    return rec;
  } catch (err) {
    rec.error = err instanceof Error ? err.message : String(err);
    return rec;
  } finally {
    rec.finishedAt = new Date().toISOString();
    save();
  }
}

/** Section 9.2 "Precisión de Discover": GET /v1/capabilities, the public search behind Discover and the CLI. */
async function discover() {
  const { queries } = JSON.parse(readFileSync(join(here, "discover-queries.json"), "utf8")) as {
    queries: { q: string; relevant: string[] }[];
  };
  const rows = [];
  for (const { q, relevant } of queries) {
    const res = await call(`/v1/capabilities?q=${encodeURIComponent(q)}&limit=5`);
    const body = (await json(res)) ?? {};
    const returned = ((body.results as { id: string }[] | undefined) ?? []).map((r) => r.id);
    rows.push({ q, httpStatus: res.status, returned, p5: precisionAt5(returned, relevant) });
  }
  writeFileSync(
    join(runDir, "discover.json"),
    `${JSON.stringify({ at: new Date().toISOString(), api: API, rows }, null, 2)}\n`,
  );
}

/**
 * Section 9.2 "Compilación de snippets": read from the public catalogue index when it exposes a compile result per
 * example (any field named like "compil…" holding a boolean or { ok | compiled }). Not exposed → recorded as such.
 */
async function snippets() {
  const res = await fetch(`${API}/catalog/index.json`);
  const body = res.ok ? ((await res.json()) as { components?: Record<string, unknown>[] }) : {};
  const rows: { id: string; compiles: boolean | null; field: string | null }[] = [];
  const read = (v: unknown): boolean | null =>
    typeof v === "boolean"
      ? v
      : v && typeof v === "object"
        ? ((["ok", "compiled", "compiles"]
            .map((k) => (v as Record<string, unknown>)[k])
            .find((x) => typeof x === "boolean") as boolean | undefined) ?? null)
        : null;
  const find = (o: Record<string, unknown>, path = ""): [string, boolean] | null => {
    for (const [k, v] of Object.entries(o)) {
      if (/compil/i.test(k) && read(v) !== null) return [`${path}${k}`, read(v) as boolean];
      if (v && typeof v === "object" && !Array.isArray(v) && /example|snippet/i.test(k)) {
        const inner = find(v as Record<string, unknown>, `${path}${k}.`);
        if (inner) return inner;
      }
    }
    return null;
  };
  for (const c of body.components ?? []) {
    if (!c.example) continue;
    const hit = find(c);
    rows.push({ id: String(c.id), compiles: hit ? hit[1] : null, field: hit ? hit[0] : null });
  }
  writeFileSync(
    join(runDir, "snippets.json"),
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        source: `${API}/catalog/index.json`,
        exposed: rows.some((r) => r.compiles !== null),
        rows,
      },
      null,
      2,
    )}\n`,
  );
}

const { statements } = JSON.parse(readFileSync(join(here, "statements.json"), "utf8")) as {
  statements: Statement[];
};
const only = opt("--only")?.split(",");
const band = opt("--band");
const todo = statements.filter((s) => (!only || only.includes(s.id)) && (!band || s.band === band));
writeFileSync(
  join(runDir, "meta.json"),
  `${JSON.stringify({ runId: RUN, env: envName, api: API, startedAt: new Date().toISOString(), statements: todo.map((s) => s.id), concurrency: CONCURRENCY, generateOffers: flag("--generate-offers"), noGenerate: flag("--no-generate") }, null, 2)}\n`,
);
console.log(
  JSON.stringify({ run: RUN, env: envName, statements: todo.length, concurrency: CONCURRENCY }),
);

const queue = [...todo];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const r = await runStatement(s);
      console.log(
        JSON.stringify({
          id: r.id,
          phase: r.phase,
          http: r.plan?.httpStatus ?? null,
          state: (r.final?.result as Record<string, unknown> | undefined)?.state ?? null,
          wallS: Math.round(r.timings.wallMs / 1000),
          error: r.error,
        }),
      );
    }
  }),
);
if (!flag("--no-discover")) await discover();
await snippets();
console.log(`Raw runs in ${runDir}. Score with: tsx bench/validation/report.ts --run ${RUN}`);
