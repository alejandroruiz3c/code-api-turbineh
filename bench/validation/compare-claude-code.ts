/**
 * Section 11.3 comparison (audit report v2) — SKELETON, prepared and not run yet. The 30 statements of
 * statements.json given to (b) Claude Code + Opus 5.5 and (c) Claude Code + Fable 5.1, each with the same standard
 * CLAUDE.md and the same open-source gate, scored with the same functions as YES IF (metrics.ts → report.ts).
 * See compare-claude-code.md for the method, the cost and time expectations and what is still to decide.
 *
 *   tsx bench/validation/compare-claude-code.ts --config opus --only A01,B01,C01          # prints the plan only
 *   tsx bench/validation/compare-claude-code.ts --config opus --execute [--parallel 3]    # runs (Docker, paid API)
 *   COMPARE_MODEL_FABLE=<model id> tsx … --config fable --execute
 *
 * Each agent runs inside the bench/baseline container (never on the host), with only ANTHROPIC_API_KEY; the
 * produced repository goes through `verify()` (@turbineh/verifier), the same gate as YES IF builds. Records are written
 * as StatementRun (runs/<run>/<id>.json) so `report.ts --run <run>` scores them unchanged.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Statement, StatementRun } from "./metrics.ts";

const here = import.meta.dirname;
const root = join(here, "../..");
const argv = process.argv.slice(2);
const opt = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);

/** (b) and (c) of section 11.3. The Fable model id is set explicitly when the run is approved (no guessed ids). */
const CONFIGS = {
  opus: { model: process.env.COMPARE_MODEL_OPUS ?? "claude-opus-5-5" },
  fable: { model: process.env.COMPARE_MODEL_FABLE ?? "" },
} as const;
const configName = (opt("--config") ?? "opus") as keyof typeof CONFIGS;
const MODEL = CONFIGS[configName]?.model;
if (!MODEL) throw new Error(`Set the model id for --config ${configName} (COMPARE_MODEL_FABLE)`);
const IMAGE = "turbineh/baseline:1";
const PARALLEL = Math.min(3, Number(opt("--parallel") ?? 3));
const TIMEOUT_MIN = Number(opt("--timeout-min") ?? 60);
const MAX_TURNS = opt("--max-turns") ?? "150";
const RUN =
  process.env.VALIDATION_RUN ?? `${new Date().toISOString().slice(0, 10)}-claude-${configName}`;

/** The standard CLAUDE.md of section 11.3: one test per criterion, nothing "done" without a test. */
export const CLAUDE_MD = `# CLAUDE.md

- Before writing code, list the acceptance criteria of the request, one per line, in STATUS.json.
- Write one automated test per criterion (Given/When/Then in the test title). Do not declare a criterion done
  without a passing test that proves it.
- If a criterion needs an external service you cannot reach or verify here (third-party APIs, platforms,
  hardware), do not fake it: list it under "notImplemented" with the reason. If the core of the request depends on
  it, say so and set "refused": true instead of building something else.
- Finish by running lint, typecheck, unit tests, build and E2E, and update STATUS.json with the real result.

STATUS.json shape:
{ "refused": false, "criteria": [{ "text": "...", "test": "file › title", "status": "met" | "open" }],
  "notImplemented": [{ "requirement": "...", "why": "..." }], "checks": "passed/total" }
`;

/** The same delivery contract as bench/baseline (same stack and scripts as YES IF builds, so the same gate applies). */
const contract = `

Build this as a complete, production-ready web app in the current directory, working autonomously (do not ask
questions). Next.js (App Router) + TypeScript strict, pnpm 10 with a committed pnpm-lock.yaml, PostgreSQL through
DATABASE_URL, package.json scripts lint, typecheck, test (vitest), build, db:generate, db:migrate, test:e2e
(@playwright/test 1.63.0 with the webServer option). Tests run without internet access. Follow CLAUDE.md.`;

interface AgentStatus {
  refused?: boolean;
  criteria?: { text: string; test?: string; status: "met" | "open" }[];
  notImplemented?: { requirement: string; why: string }[];
}

/** Agent output → the StatementRun shape scored by metrics.ts (refusal ≈ use_case_not_covered, gaps ≈ removed). */
export function toStatementRun(
  s: Statement,
  status: AgentStatus | null,
  gate: { ok: boolean; passed: number; total: number } | null,
  t: { wallMs: number; costUsd: number | null },
): StatementRun {
  const notImpl = status?.notImplemented ?? [];
  // A criterion is met only when the agent says so AND the gate passed (the tests really ran green).
  const criteria = (status?.criteria ?? []).map((c) => ({
    text: c.text,
    status: c.status === "met" && gate?.ok ? "met" : "open",
  }));
  const refused = Boolean(status?.refused);
  return {
    id: s.id,
    band: s.band,
    env: `claude-code:${MODEL}`,
    api: "local-container",
    runId: RUN,
    startedAt: "",
    finishedAt: new Date().toISOString(),
    phase: status ? "done" : "error",
    error: status ? null : "no STATUS.json",
    flowId: refused ? null : s.id,
    plan: refused
      ? {
          httpStatus: 422,
          problem: {
            code: "use_case_not_covered",
            notCovered: notImpl.map((n) => `${n.requirement} — ${n.why}`),
          },
          body: null,
          ms: 0,
        }
      : {
          httpStatus: 200,
          problem: null,
          body: {
            scope: {
              status: notImpl.length ? "partial" : "covered",
              removed: notImpl.map((n) => ({
                requirement: n.requirement,
                why: n.why,
                covered: false,
              })),
            },
          },
          ms: 0,
        },
    approved: null,
    generate: refused ? null : { httpStatus: 200, body: null },
    final: refused
      ? null
      : {
          result: {
            state: gate?.ok ? "verified" : "generated",
            outcome: {
              checks: gate ? { passed: gate.passed, total: gate.total } : undefined,
              requirements: {
                met: criteria.filter((c) => c.status === "met").length,
                total: criteria.length,
              },
            },
          },
        },
    build: { metrics: { cost: { totalEur: null, totalUsd: t.costUsd } } },
    manifest: null,
    guide: refused ? null : { status: gate?.ok ? "verified" : "unverified", criteria, left: [] },
    timings: { planMs: null, generateMs: t.wallMs, wallMs: t.wallMs },
  };
}

async function runAgent(s: Statement, key: string) {
  const dir = join(root, "builds/compare", RUN, s.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "CLAUDE.md"), CLAUDE_MD);
  execFileSync("chmod", ["-R", "777", dir]);
  const envDir = join(tmpdir(), `turbineh-compare-${process.pid}-${s.id}`);
  mkdirSync(envDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(envDir, "env"), `ANTHROPIC_API_KEY=${key}\nDISABLE_TELEMETRY=1\n`, {
    mode: 0o600,
  });
  const t0 = Date.now();
  const name = `turbineh-compare-${s.id}-${process.pid}`;
  const out = await new Promise<{ stdout: string; timedOut: boolean }>((resolve) => {
    const child = spawn("docker", [
      "run",
      "--rm",
      "--name",
      name,
      "--env-file",
      join(envDir, "env"),
      "--memory",
      "6g",
      "--cpus",
      "4",
      "--security-opt",
      "no-new-privileges",
      "-v",
      `${dir}:/work`,
      IMAGE,
      "claude",
      "-p",
      s.prompt + contract,
      "--model",
      MODEL,
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
      "--max-turns",
      MAX_TURNS,
    ]);
    let stdout = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      spawnSync("docker", ["kill", name]);
    }, TIMEOUT_MIN * 60_000);
    child.on("close", () => {
      clearTimeout(timer);
      rmSync(envDir, { recursive: true, force: true });
      resolve({ stdout, timedOut });
    });
  });
  const report = (() => {
    try {
      return JSON.parse(out.stdout.trim().split("\n").pop() ?? "{}") as { total_cost_usd?: number };
    } catch {
      return {};
    }
  })();
  const status = existsSync(join(dir, "STATUS.json"))
    ? (JSON.parse(readFileSync(join(dir, "STATUS.json"), "utf8")) as AgentStatus)
    : null;
  // The same gate as YES IF builds (sandbox without internet, lint, typecheck, unit, build, E2E, gitleaks, Semgrep,
  // OSV, licences). Imported lazily so the plan-only mode runs without the workspace build.
  let gate: { ok: boolean; passed: number; total: number } | null = null;
  if (existsSync(join(dir, "pnpm-lock.yaml"))) {
    const { verify } = await import("@turbineh/verifier");
    const v = await verify(dir);
    gate = {
      ok: v.ok,
      passed: v.steps.filter((x: { ok: boolean }) => x.ok).length,
      total: v.steps.length,
    };
  }
  return toStatementRun(s, status, gate, {
    wallMs: Date.now() - t0,
    costUsd: report.total_cost_usd ?? null,
  });
}

const { statements } = JSON.parse(readFileSync(join(here, "statements.json"), "utf8")) as {
  statements: Statement[];
};
const only = opt("--only")?.split(",");
const todo = statements.filter((s) => !only || only.includes(s.id));
if (!argv.includes("--execute")) {
  console.log(
    JSON.stringify(
      {
        run: RUN,
        config: configName,
        model: MODEL,
        statements: todo.map((s) => s.id),
        parallel: PARALLEL,
        timeoutMin: TIMEOUT_MIN,
        note: "plan only — add --execute to run (Docker, paid API)",
      },
      null,
      2,
    ),
  );
} else {
  const key = /^ANTHROPIC_API_KEY=(.+)$/m
    .exec(readFileSync(join(root, ".env.local"), "utf8"))?.[1]
    ?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY missing in .env.local");
  if (spawnSync("docker", ["image", "inspect", IMAGE]).status !== 0)
    execFileSync("docker", ["build", "-q", "-t", IMAGE, join(root, "bench/baseline")], {
      stdio: "inherit",
    });
  const runDir = join(here, "runs", RUN);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "meta.json"),
    `${JSON.stringify({ runId: RUN, env: `claude-code:${MODEL}`, api: "local-container", startedAt: new Date().toISOString(), statements: todo.map((s) => s.id) }, null, 2)}\n`,
  );
  const queue = todo.filter((s) => !existsSync(join(runDir, `${s.id}.json`)));
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const r = await runAgent(s, key);
        writeFileSync(join(runDir, `${s.id}.json`), `${JSON.stringify(r, null, 2)}\n`);
        console.log(
          JSON.stringify({ id: s.id, phase: r.phase, wallS: Math.round(r.timings.wallMs / 1000) }),
        );
      }
    }),
  );
  console.log(`Score with: tsx bench/validation/report.ts --run ${RUN}`);
}
