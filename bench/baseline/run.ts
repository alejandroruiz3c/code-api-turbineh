/**
 * Baseline runner (ADR-0009, PLAN §12): the same prompts given to a conventional full-generation agent (Claude Code
 * headless + Claude Opus 5.5) inside an ephemeral container, then the produced repository goes through exactly the
 * same verification as our builds (`verify()`: sandbox without internet, lint, typecheck, unit, build, E2E, gitleaks,
 * Semgrep, OSV, licences).
 *
 *   pnpm --filter @turbineh/bench baseline -- --only saas-01
 *   pnpm --filter @turbineh/bench baseline            # all prompts
 *
 * Outputs stay in builds/baseline/ (git-ignored): never copied into the catalog or used for training.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verify } from "@turbineh/verifier";

const root = join(import.meta.dirname, "../..");
const IMAGE = "turbineh/baseline:1";
const MODEL = process.env.BASELINE_MODEL ?? "claude-opus-5-5";
const AGENT = "claude-code@2.1.283";
const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : null;

const key = /^ANTHROPIC_API_KEY=(.+)$/m
  .exec(readFileSync(join(root, ".env.local"), "utf8"))?.[1]
  ?.trim();
if (!key) throw new Error("ANTHROPIC_API_KEY missing in .env.local");

/** The same delivery contract our builds satisfy, so both sides go through the same gate. */
const CONTRACT = `

Build this as a complete, production-ready web app in the current directory, working autonomously until done
(do not ask questions). Requirements for the delivered repository:
- Next.js (App Router) + TypeScript strict, pnpm 10, with a committed pnpm-lock.yaml (run pnpm install).
- PostgreSQL through the DATABASE_URL environment variable. Authentication with workspaces/roles if the app needs
  users. Environment variables available when tests run: DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL.
- package.json scripts that must all pass: "lint", "typecheck", "test" (unit tests, vitest), "build",
  "db:generate" (generate SQL migrations), "db:migrate" (apply them to DATABASE_URL),
  "test:e2e" (Playwright, use @playwright/test exactly 1.63.0 — browsers are preinstalled; start the built app
  with "next start" through the Playwright webServer option).
- Tests run without internet access. Secure by default (validation, authorization, no secrets in code).`;

interface Prompt {
  id: string;
  expected_recipe: string;
  prompt: string;
}

function ensureImage(): void {
  if (spawnSync("docker", ["image", "inspect", IMAGE]).status === 0) return;
  execFileSync("docker", ["build", "-q", "-t", IMAGE, join(root, "bench/baseline")], {
    stdio: "inherit",
  });
}

async function runOne(p: Prompt) {
  const dir = join(root, "builds/baseline", `${p.id}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  execFileSync("chmod", ["777", dir]);
  // The key reaches the container through a private env file that is deleted right after the run.
  const envDir = join(tmpdir(), `turbineh-baseline-${process.pid}`);
  mkdirSync(envDir, { recursive: true, mode: 0o700 });
  const envFile = join(envDir, "env");
  writeFileSync(envFile, `ANTHROPIC_API_KEY=${key}\nDISABLE_TELEMETRY=1\nDISABLE_AUTOUPDATER=1\n`, {
    mode: 0o600,
  });
  const t0 = Date.now();
  let agent: ReturnType<typeof spawnSync>;
  try {
    agent = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--env-file",
        envFile,
        "--memory",
        "6g",
        "--cpus",
        "4",
        "--pids-limit",
        "4096",
        "--security-opt",
        "no-new-privileges",
        "-v",
        `${dir}:/work`,
        IMAGE,
        "claude",
        "-p",
        p.prompt + CONTRACT,
        "--model",
        MODEL,
        "--output-format",
        "json",
        "--dangerously-skip-permissions",
        "--max-turns",
        "300",
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 90 * 60_000 },
    );
  } finally {
    rmSync(envDir, { recursive: true, force: true });
  }
  const agentMs = Date.now() - t0;
  let report: Record<string, unknown> = {};
  try {
    report = JSON.parse(String(agent.stdout).trim().split("\n").pop() ?? "{}") as Record<
      string,
      unknown
    >;
  } catch {
    report = {
      parseError: String(agent.stdout).slice(-500),
      stderr: String(agent.stderr).slice(-500),
    };
  }
  if (existsSync(join(dir, "package.json")) && !existsSync(join(dir, ".git"))) {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  }
  if (existsSync(join(dir, ".git"))) {
    execFileSync("git", ["add", "-A"], { cwd: dir });
    spawnSync(
      "git",
      [
        "-c",
        "user.name=baseline",
        "-c",
        "user.email=baseline@bench",
        "commit",
        "-qm",
        "baseline output",
      ],
      { cwd: dir },
    );
  }
  const hasLock = existsSync(join(dir, "pnpm-lock.yaml"));
  const v0 = Date.now();
  const v = hasLock ? await verify(dir) : null;
  const usage = (report.usage ?? {}) as Record<string, number>;
  return {
    id: p.id,
    agent: AGENT,
    model: MODEL,
    dir: dir.replace(`${root}/`, ""),
    agentExit: agent.status,
    agentS: Math.round(agentMs / 1000),
    turns: report.num_turns ?? null,
    costUsd: report.total_cost_usd ?? null,
    tokens: {
      input: usage.input_tokens ?? null,
      output: usage.output_tokens ?? null,
      cacheRead: usage.cache_read_input_tokens ?? null,
      cacheWrite: usage.cache_creation_input_tokens ?? null,
    },
    green: v?.ok ?? false,
    verifyS: v ? Math.round((Date.now() - v0) / 1000) : null,
    checks: v ? Object.fromEntries(v.steps.map((s) => [s.name, s.ok])) : { lockfile: false },
    security: v
      ? {
          staticErrors: v.findings.static.filter((f) => f.severity === "ERROR").length,
          staticWarnings: v.findings.static.filter((f) => f.severity === "WARNING").length,
          advisories: v.findings.advisories.length,
          secrets: v.findings.secrets,
          blockedLicences: v.findings.licenses.length,
        }
      : null,
    agentError: agent.status === 0 ? null : String(agent.stderr).slice(-400),
  };
}

const prompts = readdirSync(join(root, "bench/prompts"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(root, "bench/prompts", f), "utf8")) as Prompt)
  .filter((p) => !only || p.id === only)
  .sort((a, b) => a.id.localeCompare(b.id));

ensureImage();
const results = [];
for (const p of prompts) {
  const r = await runOne(p);
  results.push(r);
  console.log(JSON.stringify({ id: r.id, green: r.green, agentS: r.agentS, costUsd: r.costUsd }));
}
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const out = join(root, `bench/results/${stamp}-baseline${only ? `-${only}` : ""}.json`);
writeFileSync(
  out,
  JSON.stringify({ agent: AGENT, model: MODEL, date: new Date().toISOString(), results }, null, 2) +
    "\n",
);
console.log(`written ${out.replace(`${root}/`, "")}`);
