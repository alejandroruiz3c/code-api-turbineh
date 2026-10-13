import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  PNPM_STORE_VOLUME,
  POSTGRES_IMAGE,
  run,
  SANDBOX_IMAGE,
  aiSynthetic,
  STRIPE_MOCK_IMAGE,
  STRIPE_SYNTHETIC,
  SYNTHETIC_ENV,
  requiredEnv,
  type RunResult,
} from "./sandbox.js";

/** Deterministic AI simulator mounted read-only into the sandbox image (services/ai-mock). */
const AI_MOCK_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../services/ai-mock");

export type StepName =
  | "install"
  | "migrations"
  | "typecheck"
  | "lint"
  | "unit"
  | "build"
  | "e2e"
  | "secrets"
  | "static"
  | "dependencies"
  | "licenses";

/** One static-analysis finding (own Semgrep rules). ERROR blocks delivery; WARNING is an alert. */
export interface StaticFinding {
  rule: string;
  severity: "ERROR" | "WARNING";
  path: string;
  line: number;
  message: string;
  explain: string;
  /**
   * security: a weakness an attacker could use. policy: our delivery policy (e.g. a secret-shaped test placeholder in
   * a tracked file) — it still blocks when its severity says so, but it is reported as what it is.
   */
  category?: FindingCategory;
}

export type FindingCategory = "security" | "policy";

/** Gate findings grouped honestly: what is a vulnerability, what is our policy, what is app quality. */
export interface GateFinding {
  category: FindingCategory | "quality";
  /** Rule id, licence expression or failing step. */
  rule: string;
  where: string;
  blocking: boolean;
  message: string;
}

export interface StepResult {
  name: StepName;
  ok: boolean;
  ms: number;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  steps: StepResult[];
  findings: {
    secrets: number;
    advisories: {
      id: string;
      pkg: string;
      severity: string;
      scope: "production" | "development";
    }[];
    licenses: string[];
    static: StaticFinding[];
  };
  scannedAt: string;
}

/** Files that are never shipped to users: test code, test configuration and examples. */
const TEST_FILE =
  /(^|\/)(tests?|e2e|__tests__|fixtures?)\/|(^|\/)(playwright|vitest|jest)\.config\.[cm]?[jt]s$|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)\.env\.example$/;
/** Words that mark a value as a placeholder rather than a credential. */
const PLACEHOLDER =
  /(test|e2e|local|example|dummy|placeholder|change[-_]?me|stub|fake|sandbox|synthetic)/i;

/**
 * Deterministic category of a static finding. A secret-shaped literal is a security finding unless it sits in test
 * code/configuration or is an obvious placeholder: then it is a policy finding (no literal secrets in tracked files).
 */
export function findingCategory(f: StaticFinding, lineText = ""): FindingCategory {
  if (f.rule !== "turbineh.hardcoded-secret") return "security";
  return TEST_FILE.test(f.path) || PLACEHOLDER.test(lineText) ? "policy" : "security";
}

/** Every gate finding with its honest category (security / policy / quality), blocking or not. */
export function gateFindings(v: VerifyResult): GateFinding[] {
  const out: GateFinding[] = [];
  for (const f of v.findings.static) {
    out.push({
      category: f.category ?? findingCategory(f),
      rule: f.rule,
      where: `${f.path}:${f.line}`,
      blocking: f.severity === "ERROR",
      message: f.message,
    });
  }
  for (const a of v.findings.advisories) {
    out.push({
      category: "security",
      rule: a.id,
      where: a.pkg,
      blocking: a.scope === "production" && (a.severity === "CRITICAL" || a.severity === "HIGH"),
      message: `${a.severity} advisory (${a.scope})`,
    });
  }
  for (const l of v.findings.licenses) {
    const [pkg = l, ...expr] = l.split(" ");
    out.push({
      category: "policy",
      rule: "licence-policy",
      where: pkg,
      blocking: true,
      message: `Licence ${expr.join(" ")} is outside the delivery licence policy (copyleft or unknown); not a vulnerability. If it comes from an optional binary (e.g. sharp → libvips), exclude it with pnpm.ignoredOptionalDependencies.`,
    });
  }
  if (v.findings.secrets > 0) {
    out.push({
      category: "security",
      rule: "gitleaks",
      where: "git history",
      blocking: true,
      message:
        "A secret-shaped value is in the git history (redacted). Generate test secrets at runtime instead of committing them.",
    });
  }
  for (const s of v.steps) {
    if (s.ok || ["secrets", "static", "dependencies", "licenses"].includes(s.name)) continue;
    out.push({
      category: "quality",
      rule: s.name,
      where: failureLocation(s.detail) ?? s.name,
      blocking: true,
      message: `${s.name} failed`,
    });
  }
  return out;
}

/** First "file:line" a failing step points to (tsc, eslint, vitest or Playwright output), if any. */
export function failureLocation(detail: string): string | null {
  const tsc = /((?:src|tests|scripts)\/[\w./[\]-]+\.[cm]?[jt]sx?)\((\d+),\d+\)/.exec(detail);
  if (tsc) return `${tsc[1]}:${tsc[2]}`;
  const any = /((?:src|tests|scripts)\/[\w./[\]-]+\.[cm]?[jt]sx?):(\d+)/.exec(detail);
  if (any) return `${any[1]}:${any[2]}`;
  const eslint = /^(\/?[\w./[\]-]+\.[cm]?[jt]sx?)\n\s+(\d+):\d+\s+error/m.exec(detail);
  if (eslint) return `${eslint[1]?.replace(/^\/(work|src|opt\/base|tmp\/app)\//, "")}:${eslint[2]}`;
  return null;
}

/** Copyleft / unknown licenses that block delivery in the beta (direct and transitive dependencies). */
const BLOCKING_LICENSE = /\b(A?GPL|LGPL|SSPL|EUPL|CC-BY-NC|UNLICENSED)\b/i;

/**
 * SPDX semantics for dependency licences: "A OR B" lets us choose, so it blocks only when every alternative blocks
 * (e.g. jszip "MIT OR GPL-3.0-or-later" is used under MIT); "A AND B" blocks when any part blocks. Parentheses and
 * precedence (AND binds tighter than OR) are respected; an expression that cannot be parsed blocks.
 */
/** "LICENSE_BAD name@version EXPRESSION" (one line of the sandbox licence scan): only the expression decides. */
export function licenseLineBlocks(line: string): boolean {
  return licenseBlocks(line.split(" ").slice(2).join(" "));
}

export function licenseBlocks(expression: string): boolean {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const atom = (): boolean => {
    const t = tokens[i++];
    if (t === undefined) throw new Error("unexpected end");
    if (t === "(") {
      const v = or();
      if (tokens[i++] !== ")") throw new Error("missing )");
      return v;
    }
    if (/^(AND|OR|\))$/i.test(t)) throw new Error("unexpected operator");
    // "GPL-2.0 WITH Classpath-exception-2.0": the exception does not remove the copyleft licence.
    if (tokens[i]?.toUpperCase() === "WITH") i += 2;
    return BLOCKING_LICENSE.test(t);
  };
  const and = (): boolean => {
    let v = atom();
    while (tokens[i]?.toUpperCase() === "AND") {
      i++;
      v = atom() || v;
    }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (tokens[i]?.toUpperCase() === "OR") {
      i++;
      v = and() && v;
    }
    return v;
  };
  try {
    const v = or();
    return i === tokens.length ? v : true;
  } catch {
    return true;
  }
}

/**
 * `STEP <name> <exit> <ms>` lines of the sandbox output → step results. A failing step's detail starts with its own
 * key lines (`FAILED_LINE <step> …`: test headers, error messages, file:line), then the output tail.
 */
export function parseSteps(tail: string): StepResult[] {
  const steps: StepResult[] = [];
  const lines = tail.split("\n");
  for (const line of lines) {
    const m = /^STEP (\w+) (\d+) (\d+)$/.exec(line.trim());
    if (!m) continue;
    const name = m[1] as StepName;
    const own = lines
      .filter((l) => l.startsWith(`FAILED_LINE ${name} `))
      .map((l) => l.slice(`FAILED_LINE ${name} `.length));
    steps.push({
      name,
      ok: m[2] === "0",
      ms: Number(m[3]),
      detail: m[2] === "0" ? "" : [...own, ...(own.length ? ["---"] : []), tail].join("\n"),
    });
  }
  return steps;
}

/**
 * Full verification gate (PLAN §5.2), optimised for speed without relaxing isolation (ADR-0011, ADR-0014):
 *  - one container on a per-build `--internal` network (no internet) with an ephemeral Postgres started up front;
 *  - dependencies come pre-installed in a base image keyed by the lockfile hash (offline install as fallback);
 *  - strict typecheck, lint and unit tests run in parallel with the production build (no check removed);
 *  - read-only scans (secrets, static rules, advisories) run concurrently with the build;
 *  - build and unit tests see only the variables src/env.ts requires (ADR-0035): optional settings never block them.
 * `localDb`: no Postgres container and no DATABASE_URL for migrations and E2E — the package must bring its own
 * zero-setup database (`scripts/local-db.ts`), exactly as a coding agent without PostgreSQL runs it.
 */
export async function verify(dir: string, opts: { localDb?: boolean } = {}): Promise<VerifyResult> {
  const lockHash = createHash("sha256")
    .update(readFileSync(join(dir, "pnpm-lock.yaml")))
    .digest("hex")
    .slice(0, 12);
  const net = `turbineh-sbx-${randomUUID().slice(0, 8)}`;
  const dbHost = `${net}-db`;
  const [baseImage] = await Promise.all([
    ensureBaseImage(dir, lockHash),
    run("docker", ["network", "create", "--internal", net]),
  ]);
  if (!opts.localDb)
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
  // Shop apps: Stripe's official API simulator on the same isolated network, so checkout and the signed webhook
  // are exercised end to end without internet or real keys.
  const stripeHost = `${net}-stripe`;
  // Apps that ship their own mock (tests/e2e/mocks/<ENV>.mjs, started by playwright.config.ts) need no container.
  const ships = (envVar: string) =>
    existsSync(join(dir, `tests/e2e/mocks/${envVar}.mjs`)) ||
    existsSync(join(dir, `tests/e2e/mocks/${envVar}.ts`));
  const shop =
    (existsSync(join(dir, "src/server/stripe.ts")) ||
      existsSync(join(dir, "src/lib/billing.ts"))) &&
    !ships("STRIPE_API_BASE");
  if (shop) {
    await run("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      stripeHost,
      "--network",
      net,
      STRIPE_MOCK_IMAGE,
    ]);
  }
  // AI apps (orchestrator component): a deterministic model + decider simulator on the same isolated network.
  const aiHost = `${net}-ai`;
  const aiApp = existsSync(join(dir, "src/lib/ai/orchestrator.ts")) && !ships("TURBINEH_AI_URL");
  if (aiApp) {
    await run("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      aiHost,
      "--network",
      net,
      "-v",
      `${AI_MOCK_DIR}:/mock:ro`,
      SANDBOX_IMAGE,
      "node",
      "/mock/server.mjs",
    ]);
  }
  const scans = Promise.all([secretsScan(dir), staticScan(dir), osvScan(dir)]);
  // Awaited later: mark it handled now so a failure surfaces at the await instead of crashing the process.
  scans.catch(() => undefined);
  const appEnv: Record<string, string> = {
    ...SYNTHETIC_ENV,
    // localDb: the documented local value (the build needs one); migrations and E2E run without it.
    DATABASE_URL: opts.localDb
      ? "postgres://postgres:postgres@127.0.0.1:54329/postgres"
      : `postgres://app:app@${dbHost}:5432/app`,
    ...(shop ? { ...STRIPE_SYNTHETIC, STRIPE_API_BASE: `http://${stripeHost}:12111` } : {}),
    ...(aiApp ? aiSynthetic(aiHost) : {}),
  };
  const containerEnv: Record<string, string> = {
    ...appEnv,
    BASE_HASH: lockHash,
    DB_HOST: opts.localDb ? "" : dbHost,
    LOCAL_DB: opts.localDb ? "1" : "",
    ONLY_REQUIRED_UNSET: onlyRequiredUnset(dir, appEnv),
  };
  let main: RunResult;
  try {
    main = await run(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        net,
        "--memory",
        process.env.SANDBOX_MEMORY ?? "6g",
        "--cpus",
        process.env.SANDBOX_CPUS ?? "4",
        "--pids-limit",
        "4096",
        "--security-opt",
        "no-new-privileges",
        "-v",
        `${PNPM_STORE_VOLUME}:/pnpm-store`,
        "-v",
        `${dir}:/src`,
        ...Object.entries(containerEnv).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
        baseImage ?? SANDBOX_IMAGE,
        "sh",
        "-c",
        VERIFY_SCRIPT,
      ],
      20 * 60_000,
    );
  } finally {
    if (!opts.localDb) await run("docker", ["rm", "-f", dbHost]);
    if (shop) await run("docker", ["rm", "-f", stripeHost]);
    if (aiApp) await run("docker", ["rm", "-f", aiHost]);
    await run("docker", ["network", "rm", net]);
  }
  const [secrets, scanned, advisories] = await scans;
  const staticFindings = scanned ? labelFindings(dir, scanned) : null;

  const steps: StepResult[] = parseSteps(main.tail);
  if (main.code !== 0 && steps.every((x) => x.ok))
    steps.push({ name: "install", ok: false, ms: main.ms, detail: main.tail });

  const licenseLines = [
    ...new Set(main.tail.split("\n").filter((l) => l.startsWith("LICENSE_BAD "))),
  ];
  const blockingLicenses = licenseLines
    .filter(licenseLineBlocks)
    .map((l) => l.slice("LICENSE_BAD ".length));
  steps.push(secrets);
  steps.push({
    name: "static",
    ok: staticFindings !== null && !staticFindings.some((f) => f.severity === "ERROR"),
    ms: 0,
    detail:
      staticFindings === null
        ? "static scanner gave no result (retried once)"
        : staticFindings
            .map((f) => `${f.severity} [${f.category}] ${f.rule} ${f.path}:${f.line}`)
            .join("\n"),
  });
  steps.push({
    name: "dependencies",
    ok: !advisories.some(
      (a) => a.scope === "production" && (a.severity === "CRITICAL" || a.severity === "HIGH"),
    ),
    ms: 0,
    detail: advisories.map((a) => `${a.id} ${a.pkg} ${a.severity} ${a.scope}`).join("\n"),
  });
  steps.push({
    name: "licenses",
    ok: blockingLicenses.length === 0 && main.tail.includes("LICENSE_TOTAL"),
    ms: 0,
    detail: blockingLicenses.join("\n"),
  });
  return {
    ok: steps.every((x) => x.ok),
    steps,
    findings: {
      secrets: secrets.ok ? 0 : 1,
      advisories,
      licenses: blockingLicenses,
      static: staticFindings ?? [],
    },
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Fast inner-loop check for the corrector: lint, typecheck and unit tests in parallel, no network, no database, no
 * build/E2E/scans. It never replaces `verify()`: a build is accepted only after a full verification.
 */
export async function quickCheck(dir: string): Promise<VerifyResult> {
  const lockHash = createHash("sha256")
    .update(readFileSync(join(dir, "pnpm-lock.yaml")))
    .digest("hex")
    .slice(0, 12);
  const baseImage = await ensureBaseImage(dir, lockHash);
  const main = await run(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--memory",
      process.env.SANDBOX_MEMORY ?? "6g",
      "--cpus",
      process.env.SANDBOX_CPUS ?? "4",
      "--pids-limit",
      "4096",
      "--security-opt",
      "no-new-privileges",
      "-v",
      `${PNPM_STORE_VOLUME}:/pnpm-store`,
      "-v",
      `${dir}:/src:ro`,
      ...Object.entries({
        ...SYNTHETIC_ENV,
        BASE_HASH: lockHash,
        ONLY_REQUIRED_UNSET: onlyRequiredUnset(dir, SYNTHETIC_ENV),
      }).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
      baseImage ?? SANDBOX_IMAGE,
      "sh",
      "-c",
      QUICK_SCRIPT,
    ],
    10 * 60_000,
  );
  const steps: StepResult[] = parseSteps(main.tail);
  if (main.code !== 0 && steps.every((x) => x.ok))
    steps.push({ name: "install", ok: false, ms: main.ms, detail: main.tail });
  return {
    ok: steps.every((x) => x.ok),
    steps,
    findings: { secrets: 0, advisories: [], licenses: [], static: [] },
    scannedAt: new Date().toISOString(),
  };
}

const QUICK_SCRIPT = String.raw`
set -u
now() { date +%s%3N; }
step() { n=$1; shift; s=$(now); "$@" > /tmp/$n.log 2>&1; c=$?; echo "STEP $n $c $(( $(now) - s ))"; [ $c -ne 0 ] && { tail -c 1800 /tmp/$n.log; failed_lines $n; }; return $c; }
failed_lines() { grep -E '^ +[0-9]+\) |^ *(Error|AssertionError|TypeError|ReferenceError)|^ *FAIL |❯ (tests|src)/|error TS[0-9]+|^ +[0-9]+:[0-9]+ +error ' /tmp/$1.log | head -12 | cut -c1-220 | sed "s/^/FAILED_LINE $1 /"; }
only_required() { env $(for v in $ONLY_REQUIRED_UNSET; do printf -- '-u %s ' "$v"; done) "$@"; }
if [ -d /opt/base/node_modules ] && [ "$(sha256sum /src/pnpm-lock.yaml | cut -c1-12)" = "$BASE_HASH" ]; then
  W=/opt/base; (cd /src && tar --exclude=./node_modules --exclude=./.next -cf - .) | (cd $W && tar -xf -)
else
  W=/tmp/app; mkdir -p $W; (cd /src && tar --exclude=./node_modules --exclude=./.next -cf - .) | (cd $W && tar -xf -)
  cd $W && step install pnpm install --offline --frozen-lockfile || exit 1
fi
cd $W
( step lint pnpm -s lint > /tmp/out.lint ) &
( step typecheck pnpm -s typecheck > /tmp/out.typecheck ) &
( step unit only_required pnpm -s test > /tmp/out.unit ) &
wait
cat /tmp/out.lint /tmp/out.typecheck /tmp/out.unit
grep -q "STEP lint 0" /tmp/out.lint && grep -q "STEP typecheck 0" /tmp/out.typecheck && grep -q "STEP unit 0" /tmp/out.unit || exit 1
`;

/** Shell script run inside the verification container. Each step prints `STEP <name> <exit> <ms>`. */
const VERIFY_SCRIPT = String.raw`
set -u
trap 'cat /tmp/licenses.txt 2>/dev/null' EXIT
now() { date +%s%3N; }
step() { n=$1; shift; s=$(now); "$@" > /tmp/$n.log 2>&1; c=$?; echo "STEP $n $c $(( $(now) - s ))"; [ $c -ne 0 ] && { tail -c 1800 /tmp/$n.log; failed_lines $n; }; return $c; }
failed_lines() { grep -E '^ +[0-9]+\) |^ *(Error|AssertionError|TypeError|ReferenceError)|^ *FAIL |❯ (tests|src)/|error TS[0-9]+|^ +[0-9]+:[0-9]+ +error ' /tmp/$1.log | head -12 | cut -c1-220 | sed "s/^/FAILED_LINE $1 /"; }
only_required() { env $(for v in $ONLY_REQUIRED_UNSET; do printf -- '-u %s ' "$v"; done) "$@"; }
if [ -d /opt/base/node_modules ] && [ "$(sha256sum /src/pnpm-lock.yaml | cut -c1-12)" = "$BASE_HASH" ]; then
  W=/opt/base; s=$(now); (cd /src && tar --exclude=./node_modules --exclude=./.next -cf - .) | (cd $W && tar -xf -); echo "STEP install 0 $(( $(now) - s ))"
else
  W=/tmp/app; mkdir -p $W; (cd /src && tar --exclude=./node_modules --exclude=./.next -cf - .) | (cd $W && tar -xf -)
  cd $W && step install pnpm install --offline --frozen-lockfile || exit 1
fi
cd $W
step migrations pnpm -s db:generate || exit 1
[ -d drizzle ] && cp -r drizzle /src/ 2>/dev/null
node -e "const fs=require('fs'),p=require('path');const r='node_modules/.pnpm';const re=/\b(A?GPL|LGPL|SSPL|EUPL|CC-BY-NC|UNLICENSED)\b/i;let t=0;for(const d of fs.readdirSync(r)){const nm=p.join(r,d,'node_modules');if(!fs.existsSync(nm))continue;for(const a of fs.readdirSync(nm)){const ns=a.startsWith('@')?fs.readdirSync(p.join(nm,a)).map(b=>a+'/'+b):[a];for(const n of ns){try{const j=JSON.parse(fs.readFileSync(p.join(nm,n,'package.json'),'utf8'));t++;const l=typeof j.license==='string'?j.license:(j.license&&j.license.type)||'UNKNOWN';if(re.test(l))console.log('LICENSE_BAD '+j.name+'@'+j.version+' '+l)}catch{}}}}console.log('LICENSE_TOTAL '+t)" > /tmp/licenses.txt 2>/dev/null
( step lint pnpm -s lint > /tmp/out.lint ) &
( step typecheck pnpm -s typecheck > /tmp/out.typecheck ) &
( step unit only_required pnpm -s test > /tmp/out.unit ) &
( step build only_required pnpm -s build > /tmp/out.build ) &
wait
cat /tmp/out.lint /tmp/out.typecheck /tmp/out.unit /tmp/out.build
grep -q "STEP lint 0" /tmp/out.lint && grep -q "STEP typecheck 0" /tmp/out.typecheck && grep -q "STEP unit 0" /tmp/out.unit && grep -q "STEP build 0" /tmp/out.build || exit 1
if [ -n "$LOCAL_DB" ]; then
  # Zero-setup database: exactly what a coding agent without PostgreSQL runs.
  step e2e env -u DATABASE_URL sh -c "pnpm -s db:migrate && pnpm -s test:e2e --reporter=line" || exit 1
else
  for i in $(seq 1 40); do node -e "require('net').connect(5432,process.env.DB_HOST).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" && break; sleep 0.5; done
  step e2e sh -c "pnpm -s db:migrate && pnpm -s test:e2e --reporter=line" || exit 1
fi
# Screen previews for the result page (best effort: never changes the verification outcome).
if [ -f playwright/.auth/owner.json ]; then
  mkdir -p /src/.turbineh-previews
  (pnpm -s start --port 3100 > /tmp/preview-server.log 2>&1 &)
  for i in $(seq 1 60); do node -e "fetch('http://127.0.0.1:3100').then(()=>process.exit(0),()=>process.exit(1))" && break; sleep 0.5; done
  cat > preview.mjs <<'JS'
import { chromium } from "@playwright/test";
const base = "http://127.0.0.1:3100";
const out = "/src/.turbineh-previews/";
const b = await chromium.launch();
const shot = async (page, path, name) => {
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.screenshot({ path: out + name + ".png" });
};
// The public home only when it is a real page: internal tools redirect visitors to sign-in, which says nothing.
const visitor = await b.newPage({ viewport: { width: 1280, height: 800 } });
await visitor.goto(base + "/", { waitUntil: "networkidle" });
const isSignIn = (await visitor.locator('input[type="password"]').count()) > 0;
if (!isSignIn) await visitor.screenshot({ path: out + "1-home.png" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, storageState: "playwright/.auth/owner.json" });
const owner = await ctx.newPage();
await shot(owner, "/dashboard", "2-dashboard");
const links = await owner.locator('nav[aria-label="Main"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
const modules = [...new Set(links.filter((h) => h && h.startsWith("/dashboard/")))].slice(0, isSignIn ? 2 : 1);
for (const [i, href] of modules.entries()) {
  await shot(owner, href, 3 + i + "-" + href.split("/").filter(Boolean).slice(1).join("-").replace(/[^a-z0-9-]/gi, ""));
}
await b.close();
JS
  timeout 90 node preview.mjs > /tmp/preview.log 2>&1 && echo "PREVIEWS ok" || echo "PREVIEWS skipped"
fi
`;

/**
 * Variables the verifier provides that the app does not require: unset for build and unit tests, so an optional
 * setting the build still needs fails the gate instead of the coding agent's first `pnpm build`.
 */
export function onlyRequiredUnset(dir: string, provided: Record<string, string>): string {
  const file = join(dir, "src/env.ts");
  const required = new Set(existsSync(file) ? requiredEnv(readFileSync(file, "utf8")) : []);
  return [...Object.keys(provided), "BASE_HASH", "DB_HOST", "LOCAL_DB"]
    .filter((k) => !required.has(k))
    .join(" ");
}

/** Base image with the recipe dependencies pre-installed, keyed by lockfile hash (built once, reused by every build). */
async function ensureBaseImage(dir: string, lockHash: string): Promise<string | null> {
  const tag = `turbineh/sandbox-base:${lockHash}`;
  if ((await run("docker", ["image", "inspect", tag])).code === 0) return tag;
  const ctx = mkdtempSync(join(tmpdir(), "turbineh-base-"));
  cpSync(join(dir, "pnpm-lock.yaml"), join(ctx, "pnpm-lock.yaml"));
  cpSync(join(dir, "package.json"), join(ctx, "package.json"));
  writeFileSync(
    join(ctx, "Dockerfile"),
    [
      `FROM ${SANDBOX_IMAGE}`,
      "USER root",
      "RUN mkdir -p /opt/base && chown pwuser:pwuser /opt/base",
      "USER pwuser",
      "WORKDIR /opt/base",
      "COPY --chown=pwuser:pwuser package.json pnpm-lock.yaml ./",
      "RUN pnpm install --frozen-lockfile && rm -f package.json",
      `LABEL turbineh.lockhash=${lockHash}`,
    ].join("\n"),
  );
  const r = await run("docker", ["build", "-q", "-t", tag, ctx], 20 * 60_000);
  return r.code === 0 ? tag : null;
}

const SEMGREP_IMAGE =
  "semgrep/semgrep:1.178.0@sha256:32e459968daabe7ab86968184a29109b9564aa00392401156f9788452b42786b";
const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../rules");

/**
 * Own security rules with the Semgrep OSS engine: read-only mount, no network, no metrics. Returns null when the
 * scanner gives no valid result (killed, timed out under load): one retry, then the "static" step fails — a scan
 * that did not run never counts as clean.
 */
export async function staticScan(dir: string): Promise<StaticFinding[] | null> {
  return (await staticScanOnce(dir)) ?? (await staticScanOnce(dir));
}

async function staticScanOnce(dir: string): Promise<StaticFinding[] | null> {
  const r = await run(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "none",
      "-v",
      `${dir}:/src:ro`,
      "-v",
      `${RULES_DIR}:/rules:ro`,
      SEMGREP_IMAGE,
      "semgrep",
      "scan",
      "--config",
      "/rules/turbineh-security.yml",
      "--metrics",
      "off",
      "--disable-version-check",
      "--quiet",
      "--json",
      "--exclude",
      "node_modules",
      "--exclude",
      ".next",
      "--exclude",
      "tests",
      "/src",
    ],
    10 * 60_000,
    true,
  );
  return parseSemgrep(r.tail);
}

/** Adds the deterministic category to each finding (reads the flagged line to recognise placeholders). */
export function labelFindings(dir: string, findings: StaticFinding[]): StaticFinding[] {
  return findings.map((f) => {
    let line = "";
    try {
      line = readFileSync(join(dir, f.path), "utf8").split("\n")[f.line - 1] ?? "";
    } catch {
      // unreadable file: categorised from its path only
    }
    return { ...f, category: findingCategory(f, line) };
  });
}

/** Semgrep JSON → findings; null when the output is not a complete result (the scan did not run). */
export function parseSemgrep(output: string): StaticFinding[] | null {
  const start = output.indexOf("{");
  let data: {
    results?: {
      check_id: string;
      path: string;
      start: { line: number };
      extra: { severity: string; message: string; metadata?: { explain?: string } };
    }[];
  };
  try {
    if (start < 0) return null;
    data = JSON.parse(output.slice(start)) as typeof data;
  } catch {
    return null;
  }
  if (!Array.isArray(data.results)) return null;
  return data.results.map((x) => ({
    rule: x.check_id.replace(/^.*turbineh\./, "turbineh."),
    severity: x.extra.severity === "ERROR" ? "ERROR" : "WARNING",
    path: x.path.replace(/^\/src\//, ""),
    line: x.start.line,
    message: x.extra.message,
    explain: x.extra.metadata?.explain ?? x.extra.message,
  }));
}

/** gitleaks over the git tree of the generated repo (tracked files only). */
async function secretsScan(dir: string): Promise<StepResult> {
  const r = await run("gitleaks", ["git", dir, "--redact", "--no-banner", "--exit-code", "1"]);
  return {
    name: "secrets",
    ok: r.code === 0,
    ms: r.ms,
    detail: r.code === 0 ? "" : "potential secret found (redacted)",
  };
}

type Lock = {
  importers?: Record<string, { dependencies?: Record<string, { version: string }> }>;
  packages?: Record<string, unknown>;
  snapshots?: Record<
    string,
    { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
  >;
};

const base = (key: string) => key.split("(")[0] ?? key;

/** name@version of every package reachable from the app's production dependencies. */
export function productionClosure(lock: Lock): Set<string> {
  const seen = new Set<string>();
  const stack = Object.entries(lock.importers?.["."]?.dependencies ?? {}).map(
    ([n, d]) => `${n}@${d.version}`,
  );
  while (stack.length) {
    const key = stack.pop() as string;
    if (seen.has(key)) continue;
    seen.add(key);
    const snap = lock.snapshots?.[key];
    for (const [n, v] of Object.entries({ ...snap?.dependencies, ...snap?.optionalDependencies })) {
      stack.push(`${n}@${v}`);
    }
  }
  return new Set([...seen].map(base));
}

/**
 * OSV advisories for every package version in the lockfile (direct and transitive), tagged as production or
 * development scope. Only production HIGH/CRITICAL findings block delivery; development-only findings are
 * reported as not reachable at runtime.
 */
async function osvScan(
  dir: string,
): Promise<{ id: string; pkg: string; severity: string; scope: "production" | "development" }[]> {
  const lock = parse(readFileSync(join(dir, "pnpm-lock.yaml"), "utf8")) as Lock;
  const prod = productionClosure(lock);
  const pkgs = Object.keys(lock.packages ?? {})
    .map((k) => {
      const at = k.lastIndexOf("@");
      return at > 0 ? { name: k.slice(0, at), version: base(k.slice(at + 1)) } : null;
    })
    .filter((p): p is { name: string; version: string } => p !== null);
  const out: { id: string; pkg: string; severity: string; scope: "production" | "development" }[] =
    [];
  for (let i = 0; i < pkgs.length; i += 500) {
    const batch = pkgs.slice(i, i + 500);
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: batch.map((p) => ({
          package: { name: p.name, ecosystem: "npm" },
          version: p.version,
        })),
      }),
    });
    const data = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
    for (const [j, r] of data.results.entries()) {
      for (const v of r.vulns ?? []) {
        const detail = (await (await fetch(`https://api.osv.dev/v1/vulns/${v.id}`)).json()) as {
          database_specific?: { severity?: string };
        };
        const pkg = `${batch[j]?.name}@${batch[j]?.version}`;
        out.push({
          id: v.id,
          pkg,
          severity: detail.database_specific?.severity ?? "UNKNOWN",
          scope: prod.has(pkg) ? "production" : "development",
        });
      }
    }
  }
  return out;
}
