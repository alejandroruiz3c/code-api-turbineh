/**
 * Functional coverage benchmark (ADR-0063; external audit v2 §9.2 "Cobertura funcional" and "Falsos verified").
 * For each labelled statement (statements.json: band A in-catalogue, band B catalogue + 1-2 uncovered capabilities) it
 * runs the public flow end to end — POST /v1/plans → generate (approving the covered part when the plan asks) → wait —
 * and records what every surface says: the plan's criteria, the result's verdict (`outcome.badge`, `outcome.functional`)
 * and the delivered turbineh.json (`functional_coverage`, criteria with their canonical links). Then it scores:
 *   - functional coverage = criteria a passing test proves / criteria derived (per flow, mean per band);
 *   - labelled recall = the reviewer's expected canonical functions that are met in the package;
 *   - false "verified" = a verdict reading "Verified" (no qualifier) with coverage < 80 %.
 *
 *   tsx bench/functional/run.ts --env staging [--only FA01,FB01] [--concurrency 3]
 *   tsx bench/functional/run.ts --score <run-dir>        # re-score a stored run without rebuilding
 *
 * Keys come from .env.local by label (never printed): STG_SMOKE_API_KEY for staging. Runs are written to
 * bench/functional/runs/<date>-<env>/ (signed URLs removed). Only numbers measured here may be published.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Statement {
  id: string;
  band: "A" | "B";
  recipe: string;
  prompt: string;
  expect: string[];
  removed?: string[];
}
interface GuideCriterion {
  text: string;
  status: string;
  canonical?: string[];
  asked?: string[];
  test?: { file: string; title: string };
}
interface Run {
  id: string;
  band: "A" | "B";
  flowId: string | null;
  refused: boolean;
  /** Why the request was refused (the API's problem), when it was. */
  problem?: unknown;
  error: string | null;
  planCriteria: unknown;
  approved: string[] | null;
  state: string | null;
  badge: string | null;
  functional: { met: number; total: number; ratio: number } | null;
  guideFunctional: { met: number; total: number; ratio: number; label: string } | null;
  criteria: GuideCriterion[];
  minutes: number | null;
}

const here = import.meta.dirname;
const root = join(here, "../..");
const argv = process.argv.slice(2);
const opt = (n: string): string | undefined =>
  argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined;
const { statements } = JSON.parse(readFileSync(join(here, "statements.json"), "utf8")) as {
  statements: Statement[];
};

export function score(runs: Run[]) {
  const byBand = (b: "A" | "B") => runs.filter((r) => r.band === b);
  const ratioOf = (r: Run) =>
    r.guideFunctional?.ratio ?? r.functional?.ratio ?? (r.refused ? null : 0);
  const mean = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null;
  const pooled = (rs: Run[]) => {
    const met = rs.reduce((a, r) => a + (r.guideFunctional?.met ?? r.functional?.met ?? 0), 0);
    const total = rs.reduce(
      (a, r) => a + (r.guideFunctional?.total ?? r.functional?.total ?? 0),
      0,
    );
    return total ? Math.round((met / total) * 1000) / 1000 : null;
  };
  const recall = (r: Run) => {
    const s = statements.find((x) => x.id === r.id);
    if (!s || r.criteria.length === 0) return null;
    const met = new Set(
      r.criteria
        .filter((c) => c.status === "met")
        .flatMap((c) => (c.canonical ?? []).map((id) => id.split(":")[0])),
    );
    return s.expect.filter((e) => met.has(e)).length / s.expect.length;
  };
  const falseVerified = runs.filter((r) => {
    const label = r.badge ?? r.guideFunctional?.label ?? "";
    const ratio = ratioOf(r);
    return /^Verified\b/.test(label) && ratio !== null && ratio < 0.8;
  });
  const band = (b: "A" | "B") => {
    const rs = byBand(b);
    const built = rs.filter((r) => !r.refused && !r.error && r.criteria.length > 0);
    return {
      statements: rs.length,
      built: built.length,
      refused: rs.filter((r) => r.refused).map((r) => r.id),
      errors: rs.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`),
      functionalCoverageMean: mean(built.map((r) => ratioOf(r) ?? 0)),
      functionalCoveragePooled: pooled(built),
      labelledRecallMean: mean(built.map(recall).filter((x): x is number => x !== null)),
      perFlow: built.map((r) => ({
        id: r.id,
        coverage: `${r.guideFunctional?.met ?? r.functional?.met}/${r.guideFunctional?.total ?? r.functional?.total}`,
        badge: r.badge,
        recall: recall(r),
        open: r.criteria.filter((c) => c.status !== "met").map((c) => c.text),
      })),
    };
  };
  return {
    bandA: band("A"),
    bandB: band("B"),
    falseVerified: falseVerified.map((r) => r.id),
    targets: { bandA: 0.9, bandB: 0.7, falseVerified: 0 },
  };
}

function readEnv(): Record<string, string> {
  const f = opt("--env-file") ?? join(root, ".env.local");
  const out: Record<string, string> = {};
  if (!existsSync(f)) return out;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1]) out[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return out;
}

async function main() {
  const scoreDir = opt("--score");
  if (scoreDir) {
    const runs = readdirSync(scoreDir)
      .filter((f) => /^F[AB]\d+\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(join(scoreDir, f), "utf8")) as Run);
    const s = score(runs);
    writeFileSync(join(scoreDir, "summary.json"), `${JSON.stringify(s, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(s, null, 2)}\n`);
    return;
  }
  const env = opt("--env") ?? "staging";
  if (env !== "staging") throw new Error("this benchmark runs on staging only");
  const API = process.env.FUNCTIONAL_API_URL ?? "https://staging.software.turbineh.com";
  const KEY = process.env.FUNCTIONAL_API_KEY ?? readEnv().STG_SMOKE_API_KEY;
  if (!KEY) throw new Error("Set STG_SMOKE_API_KEY in .env.local");
  const RUN = process.env.FUNCTIONAL_RUN ?? `${new Date().toISOString().slice(0, 10)}-${env}`;
  const runDir = join(here, "runs", RUN);
  mkdirSync(runDir, { recursive: true });
  const only = opt("--only")?.split(",");
  const todo = statements.filter((s) => !only || only.includes(s.id));
  const concurrency = Math.min(4, Math.max(1, Number(opt("--concurrency") ?? 3) || 3));
  const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`${API}${path}`, {
          ...init,
          headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
        });
        if (res.status < 500 || attempt >= 8) return res;
      } catch (err) {
        if (attempt >= 8) throw err;
      }
      await sleep(Math.min(60_000, 3000 * 2 ** attempt));
    }
  };
  const body = async (res: Response) => {
    const t = await res.text();
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      return { raw: t.slice(0, 300) } as Record<string, unknown>;
    }
  };
  const guideOf = async (id: string): Promise<Record<string, unknown> | null> => {
    const res = await call(`/v1/plans/${id}/package?format=app`);
    if (!res.ok) return null;
    const dir = mkdtempSync(join(tmpdir(), "turbineh-functional-"));
    try {
      const zip = join(dir, "app.zip");
      writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
      const entry = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
        .split("\n")
        .filter((e) => /(^|\/)turbineh\.json$/.test(e) && !e.includes("node_modules"))
        .sort((a, b) => a.split("/").length - b.split("/").length)[0];
      return entry
        ? (JSON.parse(
            execFileSync("unzip", ["-p", zip, entry], { encoding: "utf8", maxBuffer: 64 << 20 }),
          ) as Record<string, unknown>)
        : null;
    } catch {
      return null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const one = async (s: Statement): Promise<Run> => {
    const file = join(runDir, `${s.id}.json`);
    if (existsSync(file)) {
      const prev = JSON.parse(readFileSync(file, "utf8")) as Run;
      if (!prev.error) return prev;
    }
    const t0 = Date.now();
    const run: Run = {
      id: s.id,
      band: s.band,
      flowId: null,
      refused: false,
      error: null,
      planCriteria: null,
      approved: null,
      state: null,
      badge: null,
      functional: null,
      guideFunctional: null,
      criteria: [],
      minutes: null,
    };
    try {
      const res = await call("/v1/plans", {
        method: "POST",
        headers: { "Idempotency-Key": `functional-${RUN}-${s.id}` },
        body: JSON.stringify({ need: s.prompt, environment: {} }),
      });
      let plan = await body(res);
      if (res.status === 422) {
        run.refused = true;
        run.problem = plan;
        return run;
      }
      const id = typeof plan.id === "string" ? plan.id : null;
      if (!res.ok || !id) throw new Error(`POST /v1/plans → ${res.status}`);
      run.flowId = id;
      while (plan.state === "planning") {
        await sleep(3000);
        plan = await body(await call(`/v1/plans/${id}`));
      }
      run.planCriteria = plan.criteria ?? null;
      const state = String(
        (plan.result as Record<string, unknown> | undefined)?.state ?? plan.state,
      );
      if (state === "failed") {
        run.refused = true;
        run.problem = (plan.result as Record<string, unknown> | undefined)?.errors ?? plan;
        return run;
      }
      const needs = (plan.needsApproval as string[] | undefined) ?? [];
      if (needs.length) run.approved = needs;
      const g = await call(`/v1/plans/${id}/generate`, {
        method: "POST",
        body: JSON.stringify(needs.length ? { approve: true } : {}),
      });
      if (!g.ok) throw new Error(`generate → ${g.status}`);
      let final = await body(await call(`/v1/plans/${id}`));
      const now = () => String((final.result as Record<string, unknown> | undefined)?.state);
      while (
        ["planning", "planned", "generating"].includes(now()) &&
        Date.now() - t0 < 90 * 60_000
      ) {
        await sleep(10_000);
        final = await body(await call(`/v1/plans/${id}`));
      }
      const result = (final.result ?? {}) as Record<string, unknown>;
      const outcome = (result.outcome ?? {}) as Record<string, unknown>;
      run.state = now();
      run.badge = typeof outcome.badge === "string" ? outcome.badge : null;
      run.functional = (outcome.functional as Run["functional"]) ?? null;
      const guide = await guideOf(id);
      run.guideFunctional = (guide?.functional_coverage as Run["guideFunctional"]) ?? null;
      run.criteria = ((guide?.criteria as GuideCriterion[] | undefined) ?? []).map((c) => ({
        text: c.text,
        status: c.status,
        ...(c.canonical ? { canonical: c.canonical } : {}),
        ...(c.asked ? { asked: c.asked } : {}),
        ...(c.test ? { test: c.test } : {}),
      }));
      return run;
    } catch (err) {
      run.error = err instanceof Error ? err.message : String(err);
      return run;
    } finally {
      run.minutes = Math.round((Date.now() - t0) / 600) / 100;
      writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
      process.stderr.write(
        `${s.id}: ${run.error ?? run.badge ?? (run.refused ? "refused" : run.state)}\n`,
      );
    }
  };

  const queue = [...todo];
  const runs: Run[] = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) runs.push(await one(s));
    }),
  );
  const all = readdirSync(runDir)
    .filter((f) => /^F[AB]\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(runDir, f), "utf8")) as Run);
  const s = score(all);
  writeFileSync(join(runDir, "summary.json"), `${JSON.stringify(s, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(s, null, 2)}\n`);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) await main();
