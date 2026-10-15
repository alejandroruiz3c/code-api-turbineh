import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { getuid, getgid } from "node:process";
import { join, relative, sep } from "node:path";
import type { RepoAnalysis } from "@turbineh/engine";
import { POSTGRES_IMAGE, run, SANDBOX_IMAGE } from "@turbineh/verifier";

/**
 * Verification inside the client's project (PLAN §16 P5, ADR-0034). Third-party code only ever runs in the
 * ephemeral sandbox image, never on the worker:
 *  - phase A ("install"): the project's package manager talks to the npm registry only, with install scripts
 *    disabled, so no dependency code runs while there is network; dependencies from git/URLs are refused before;
 *  - phase B ("checks"): no internet at all (internal network with a throwaway PostgreSQL): lifecycle scripts, the
 *    project's typecheck/lint/tests/build, the capability's tests and its migration applied to the database.
 * No real secret ever enters: settings get placeholder values. Per-job caches (no shared store to poison).
 */

export type Pm = "pnpm" | "npm" | "yarn";

export interface SandboxPlan {
  mode: "prepare" | "verify";
  pm: Pm;
  appPath: string;
  hasLockfile: boolean;
  lockfile: string | null;
  scripts: RepoAnalysis["scripts"];
  typescript: boolean;
  slug: string;
  migration: {
    kind: "drizzle-kit" | "sql" | "none";
    dir: string | null;
    config: string | null;
    namespace: string;
  };
  capabilityTests: string[];
  /** drizzle-kit for SQL migrations when the project has none. */
  tools: Record<string, string>;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const YARN = "yarn@1.22.22";

export function pmSupported(
  pm: string | null,
  lockfile: string | null,
  repoDir: string,
): Pm | null {
  if (pm === "pnpm" || pm === "npm") return pm;
  if (pm === "yarn") {
    // Yarn classic only (Berry needs its own runtime): .yarnrc.yml / .yarn/releases mean Berry.
    if (existsSync(join(repoDir, ".yarnrc.yml")) || existsSync(join(repoDir, ".yarn/releases")))
      return null;
    return "yarn";
  }
  if (pm === null && !lockfile) return "npm";
  return null;
}

const STEP_FN = `step() { n=$1; shift; s=$(date +%s%3N); ( "$@" ) >"/job/logs/$n.log" 2>&1; c=$?; e=$(date +%s%3N); echo "STEP $n $c $((e-s))"; return $c; }`;

/** Phase A: registry only, install scripts disabled. */
export function installScript(p: SandboxPlan): string {
  const store = "--store-dir /job/cache/pnpm-store";
  const lines = ["set -u", "mkdir -p /job/logs /job/home /job/cache", STEP_FN, "cd /job/repo"];
  const updateLock =
    p.pm === "pnpm"
      ? `pnpm install --lockfile-only --ignore-scripts ${store}`
      : p.pm === "npm"
        ? "npm install --package-lock-only --ignore-scripts --no-audit --no-fund"
        : null; // yarn classic updates the lockfile while installing
  const install =
    p.pm === "pnpm"
      ? `pnpm install ${p.hasLockfile && p.mode === "verify" ? "--frozen-lockfile" : "--no-frozen-lockfile"} --ignore-scripts ${store}`
      : p.pm === "npm"
        ? p.hasLockfile
          ? "npm ci --ignore-scripts --no-audit --no-fund"
          : "npm install --ignore-scripts --no-audit --no-fund --no-package-lock"
        : `npx --yes ${YARN} install ${p.mode === "verify" ? "--frozen-lockfile" : ""} --ignore-scripts --non-interactive`;
  if (p.mode === "prepare" && p.hasLockfile && updateLock)
    lines.push(`step lockfile ${updateLock}`);
  lines.push(`step install ${install}`);
  const tools = Object.entries(p.tools);
  if (tools.length)
    lines.push(
      `step tools npm install --prefix /job/tools --ignore-scripts --no-audit --no-fund --no-save ${tools.map(([n, v]) => q(`${n}@${v}`)).join(" ")}`,
    );
  lines.push("exit 0");
  return lines.join("\n");
}

/** Phase B: offline checks (and, when preparing, the migration generation). */
export function checksScript(p: SandboxPlan): string {
  const app = p.appPath ? `/job/repo/${p.appPath}` : "/job/repo";
  const runS = (s: string) => (p.pm === "pnpm" ? `pnpm run ${s}` : `npm run ${s}`);
  const rebuild = p.pm === "pnpm" ? "pnpm rebuild" : "npm rebuild";
  const lines = [
    "set -u",
    "mkdir -p /job/logs",
    STEP_FN,
    // Wait for the throwaway database (tests and the migration use it).
    `for i in $(seq 1 30); do node -e "require('net').connect(5432, process.env.TBH_DB_HOST).on('connect', () => process.exit(0)).on('error', () => process.exit(1))" && break; sleep 1; done`,
    "cd /job/repo",
    `step scripts ${rebuild}`,
  ];
  lines.push(`cd ${q(app)}`);
  const kit = (args: string) =>
    p.migration.kind === "sql"
      ? `/job/tools/node_modules/.bin/drizzle-kit ${args}`
      : `npx --no-install drizzle-kit ${args}`;
  if (p.mode === "prepare") {
    if (p.migration.kind === "drizzle-kit")
      lines.push(
        `step migration ${kit(`generate${p.migration.config ? ` --config ${q(p.migration.config)}` : ""} --name ${q(`turbineh_${p.slug.replace(/-/g, "_")}`)}`)}`,
      );
    else if (p.migration.kind === "sql" && p.migration.dir)
      lines.push(
        `step migration ${kit(`generate --dialect postgresql --schema ${q(`${p.migration.namespace}/db/schema.ts`)} --out ${q(p.migration.dir)} --name ${q(`turbineh_${p.slug.replace(/-/g, "_")}`)}`)}`,
      );
    lines.push("exit 0");
    return lines.join("\n");
  }
  if (p.scripts.typecheck) lines.push(`step typecheck ${runS("typecheck")}`);
  else if (p.typescript) lines.push("step typecheck npx --no-install tsc --noEmit -p .");
  if (p.scripts.lint) lines.push(`step lint ${runS("lint")}`);
  if (p.scripts.test) lines.push(`step test ${runS("test")}`);
  if (p.capabilityTests.length) {
    const files = p.capabilityTests.map(q).join(" ");
    // The project's own vitest config first (aliases, environment); ours when its `include` skips the files.
    lines.push(
      `step capability-tests sh -c ${q(`npx --no-install vitest run ${files} > /job/logs/ct1.log 2>&1 && cat /job/logs/ct1.log && exit 0; if grep -q "No test files found" /job/logs/ct1.log; then npx --no-install vitest run --config /job/tbh-vitest.config.mjs ${files}; else cat /job/logs/ct1.log; exit 1; fi`)}`,
    );
  }
  if (p.migration.kind === "drizzle-kit")
    lines.push(
      `step migrate ${kit(`migrate${p.migration.config ? ` --config ${q(p.migration.config)}` : ""}`)}`,
    );
  else if (p.migration.kind === "sql" && p.migration.dir)
    lines.push(`step migrate node /job/tbh-apply-sql.mjs ${q(p.migration.dir)}`);
  if (p.scripts.build) lines.push(`step build ${runS("build")}`);
  lines.push("exit 0");
  return lines.join("\n");
}

/** Applies a folder of .sql files in order with the project's own `pg` (no psql in the image). */
export const APPLY_SQL = `import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(join(process.cwd(), "package.json"));
const pg = require("pg");
const dir = process.argv[2];
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(dir, f), "utf8").split("--> statement-breakpoint").join("\\n");
  await client.query(sql);
  console.log("applied", f);
}
await client.end();
`;

export interface StepOutcome {
  name: string;
  code: number;
  ms: number;
  log: string;
}

const PLACEHOLDER = "sandbox-placeholder-not-a-secret-0123456789abcdef";

/** Placeholder values for the settings the project documents (never real ones). */
export function placeholderEnv(names: string[], databaseUrl: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const n of names) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(n) || /^(NODE_ENV|PORT)$/.test(n)) continue;
    env[n] = /DATABASE_URL$|POSTGRES_URL$/.test(n)
      ? databaseUrl
      : /_URL$|_URI$|_ENDPOINT$|_HOST$/.test(n)
        ? "http://127.0.0.1:9"
        : PLACEHOLDER;
  }
  return {
    ...env,
    DATABASE_URL: databaseUrl,
    CI: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    SKIP_ENV_VALIDATION: "1",
    HOME: "/job/home",
    npm_config_cache: "/job/cache/npm",
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_update_notifier: "false",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  };
}

const user = () => {
  const uid = typeof getuid === "function" ? getuid() : undefined;
  const gid = typeof getgid === "function" ? getgid() : undefined;
  return uid !== undefined && gid !== undefined ? ["--user", `${uid}:${gid}`] : [];
};

function parseSteps(jobDir: string, out: string): StepOutcome[] {
  const steps: StepOutcome[] = [];
  for (const line of out.split("\n")) {
    const m = /^STEP ([\w-]+) (\d+) (\d+)$/.exec(line.trim());
    if (!m?.[1]) continue;
    const logPath = join(jobDir, "logs", `${m[1]}.log`);
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    steps.push({ name: m[1], code: Number(m[2]), ms: Number(m[3]), log: log.slice(-20_000) });
  }
  return steps;
}

/** Runs both phases for one job directory (`<jobDir>/repo` is the project). */
export async function runSandbox(
  jobDir: string,
  plan: SandboxPlan,
  envNames: string[],
  /** Non-secret defaults documented by the capability (e.g. its gateway URL); other settings stay unset. */
  defaults: Record<string, string> = {},
): Promise<StepOutcome[]> {
  for (const d of ["logs", "home", "cache", "tools"])
    mkdirSync(join(jobDir, d), { recursive: true });
  writeFileSync(join(jobDir, "tbh-apply-sql.mjs"), APPLY_SQL);
  writeFileSync(
    join(jobDir, "tbh-vitest.config.mjs"),
    `export default { test: { include: ${JSON.stringify(plan.capabilityTests)}, passWithNoTests: false } };\n`,
  );
  const common = (env: Record<string, string>) => [
    "run",
    "--rm",
    ...user(),
    "--memory",
    process.env.SANDBOX_MEMORY ?? "6g",
    "--cpus",
    process.env.SANDBOX_CPUS ?? "4",
    "--pids-limit",
    "4096",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "-v",
    `${jobDir}:/job`,
    "-w",
    "/job/repo",
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    SANDBOX_IMAGE,
    "sh",
    "-c",
  ];
  const net = `turbineh-int-${randomUUID().slice(0, 8)}`;
  const dbHost = `${net}-db`;
  const databaseUrl = `postgres://app:app@${dbHost}:5432/app`;
  const env = { ...defaults, ...placeholderEnv(envNames, databaseUrl), TBH_DB_HOST: dbHost };
  // Phase A: default network, only the package manager runs (scripts disabled), registry pinned.
  const a = await run("docker", [...common(env), installScript(plan)], 25 * 60_000, true);
  const steps = parseSteps(jobDir, a.tail);
  if (steps.some((s) => s.code !== 0) || !steps.some((s) => s.name === "install"))
    return steps.length
      ? steps
      : [{ name: "install", code: a.code || 1, ms: a.ms, log: a.tail.slice(-4000) }];
  // Phase B: internal network (no internet) with a throwaway PostgreSQL.
  await run("docker", ["network", "create", "--internal", net]);
  try {
    {
      await run("docker", [
        "run",
        "-d",
        "--rm",
        "--name",
        dbHost,
        "--network",
        net,
        "-e",
        "POSTGRES_USER=app",
        "-e",
        "POSTGRES_PASSWORD=app",
        "-e",
        "POSTGRES_DB=app",
        POSTGRES_IMAGE,
      ]);
      await new Promise((r) => setTimeout(r, 4000));
    }
    const b = await run(
      "docker",
      [...common(env).slice(0, 1), "--network", net, ...common(env).slice(1), checksScript(plan)],
      45 * 60_000,
      true,
    );
    const more = parseSteps(jobDir, b.tail);
    if (!more.length)
      more.push({ name: "checks", code: b.code || 1, ms: b.ms, log: b.tail.slice(-4000) });
    return [...steps, ...more];
  } finally {
    await run("docker", ["rm", "-f", dbHost]);
    await run("docker", ["network", "rm", net]);
  }
}

// ── host-side hygiene of a downloaded project ────────────────────────────────────────────────────────────

const SECRET_FILE =
  /(^|\/)(\.env(?!\.(example|sample|template)$)(\..*)?|.*\.(pem|key|p12|pfx|keystore)|id_(rsa|ed25519)|\.npmrc|\.yarnrc(\.yml)?|\.netrc)$/i;

/**
 * Makes an extracted project safe to read and to mount: removes committed secret files (env files, keys, registry
 * credentials) and symlinks that point outside the project. Returns what was removed (paths only).
 */
export function sanitizeProject(dir: string): { removed: string[]; paths: string[] } {
  const removed: string[] = [];
  const paths: string[] = [];
  const root = realpathSync(dir);
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const r = relative(dir, p).split(sep).join("/");
      if (e.name === ".git" || e.name === "node_modules") continue;
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        let target: string;
        try {
          target = realpathSync(p);
        } catch {
          target = "";
        }
        if (!target || !(target === root || target.startsWith(`${root}${sep}`))) {
          unlinkSync(p);
          removed.push(r);
        } else paths.push(r);
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (SECRET_FILE.test(r)) {
        rmSync(p, { force: true });
        removed.push(r);
      } else paths.push(r);
    }
  };
  walk(dir);
  return { removed, paths: paths.sort() };
}

/** Dependencies that would make the install fetch from somewhere other than the registry. */
export function nonRegistryDependencies(dir: string, paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths.filter((x) => /(^|\/)package\.json$/.test(x))) {
    let pkg: Record<string, Record<string, string> | undefined>;
    try {
      pkg = JSON.parse(readFileSync(join(dir, p), "utf8")) as typeof pkg;
    } catch {
      continue;
    }
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
        if (typeof spec !== "string") continue;
        if (
          /^(git\+|git:|github:|gitlab:|bitbucket:|https?:|ssh:)/.test(spec) ||
          /^[\w-]+\/[\w.-]+(#.*)?$/.test(spec)
        )
          out.push(`${p}: ${name}@${spec}`);
      }
    }
  }
  return out;
}
