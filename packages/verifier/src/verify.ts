import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { POSTGRES_IMAGE, run, sandbox, SYNTHETIC_ENV, type RunResult } from "./sandbox.js";

export type StepName =
  | "install"
  | "migrations"
  | "typecheck"
  | "lint"
  | "unit"
  | "build"
  | "e2e"
  | "secrets"
  | "dependencies"
  | "licenses";

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
  };
  scannedAt: string;
}

const toStep = (name: StepName, r: RunResult): StepResult => ({
  name,
  ok: r.code === 0,
  ms: r.ms,
  detail: r.code === 0 ? "" : r.tail,
});

/** Copyleft / unknown licenses that block delivery in the beta (direct and transitive dependencies). */
const BLOCKING_LICENSE = /\b(A?GPL|LGPL|SSPL|EUPL|CC-BY-NC|UNLICENSED)\b/i;

/**
 * Full verification gate (PLAN §5.2) for an assembled app in `dir`:
 *  sandbox without network → install, migrations, typecheck, lint, unit, build
 *  internal network (no internet) + ephemeral Postgres → E2E smoke
 *  read-only scans → secrets (gitleaks on the git tree), dependency advisories (OSV), licenses
 */
export async function verify(dir: string): Promise<VerifyResult> {
  const steps: StepResult[] = [];
  const env = { ...SYNTHETIC_ENV, DATABASE_URL: "postgres://app:app@db.invalid:5432/app" };

  const offline: [StepName, string][] = [
    ["install", "pnpm install --offline --frozen-lockfile"],
    ["migrations", "pnpm -s db:generate"],
    ["typecheck", "pnpm -s typecheck"],
    ["lint", "pnpm -s lint"],
    ["unit", "pnpm -s test"],
    ["build", "pnpm -s build"],
  ];
  // One container for the offline phase keeps node_modules warm between steps; each step is timed separately.
  const script = offline
    .map(
      ([name, cmd]) =>
        `s=$(date +%s%3N); ${cmd} > /tmp/${name}.log 2>&1; c=$?; e=$(date +%s%3N); echo "STEP ${name} $c $((e-s))"; if [ $c -ne 0 ]; then tail -c 2500 /tmp/${name}.log; exit $c; fi`,
    )
    .join("\n");
  const r = await sandbox(dir, script, { network: "none", env });
  const seen = new Set<string>();
  for (const line of r.tail.split("\n")) {
    const m = /^STEP (\w+) (\d+) (\d+)$/.exec(line.trim());
    if (m) {
      seen.add(m[1] as string);
      steps.push({
        name: m[1] as StepName,
        ok: m[2] === "0",
        ms: Number(m[3]),
        detail: m[2] === "0" ? "" : r.tail,
      });
    }
  }
  if (r.code !== 0 && steps.every((s) => s.ok)) {
    const failed = offline.find(([n]) => !seen.has(n))?.[0] ?? "install";
    steps.push({ name: failed, ok: false, ms: r.ms, detail: r.tail });
  }

  if (steps.every((s) => s.ok)) steps.push(await e2e(dir));

  steps.push(await secretsScan(dir));
  const advisories = await osvScan(dir);
  steps.push({
    name: "dependencies",
    ok: !advisories.some(
      (a) => a.scope === "production" && (a.severity === "CRITICAL" || a.severity === "HIGH"),
    ),
    ms: 0,
    detail: advisories.map((a) => `${a.id} ${a.pkg} ${a.severity} ${a.scope}`).join("\n"),
  });
  const licenses = steps.find((s) => s.name === "build")?.ok ? await licenseScan(dir) : [];
  const blocking = licenses.filter((l) => !l.startsWith("TOTAL") && BLOCKING_LICENSE.test(l));
  steps.push({ name: "licenses", ok: blocking.length === 0, ms: 0, detail: blocking.join("\n") });

  const secrets = steps.find((s) => s.name === "secrets");
  return {
    ok: steps.every((s) => s.ok),
    steps,
    findings: { secrets: secrets && !secrets.ok ? 1 : 0, advisories, licenses: blocking },
    scannedAt: new Date().toISOString(),
  };
}

async function e2e(dir: string): Promise<StepResult> {
  const net = `turbineh-sbx-${randomUUID().slice(0, 8)}`;
  const db = `${net}-db`;
  await run("docker", ["network", "create", "--internal", net]);
  try {
    await run("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      db,
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
    for (let i = 0; i < 30; i++) {
      if ((await run("docker", ["exec", db, "pg_isready", "-U", "app"])).code === 0) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const res = await sandbox(dir, "pnpm -s db:migrate && pnpm -s test:e2e --reporter=line", {
      network: net,
      env: { ...SYNTHETIC_ENV, DATABASE_URL: `postgres://app:app@${db}:5432/app` },
    });
    return toStep("e2e", res);
  } finally {
    await run("docker", ["rm", "-f", db]);
    await run("docker", ["network", "rm", net]);
  }
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

/**
 * Licenses of every installed package, read inside the sandbox (package code is never executed).
 * Only blocking licenses are returned; the total count is the last element ("TOTAL n").
 */
async function licenseScan(dir: string): Promise<string[]> {
  const js = [
    "const fs=require('fs'),p=require('path');",
    "const root='node_modules/.pnpm';const bad=[];let total=0;",
    "const re=/\\b(A?GPL|LGPL|SSPL|EUPL|CC-BY-NC|UNLICENSED)\\b/i;",
    "for(const d of fs.readdirSync(root)){const nm=p.join(root,d,'node_modules');if(!fs.existsSync(nm))continue;",
    "for(const a of fs.readdirSync(nm)){const names=a.startsWith('@')?fs.readdirSync(p.join(nm,a)).map(b=>a+'/'+b):[a];",
    "for(const n of names){try{const j=JSON.parse(fs.readFileSync(p.join(nm,n,'package.json'),'utf8'));total++;",
    "const l=typeof j.license==='string'?j.license:(j.license&&j.license.type)||'UNKNOWN';",
    "if(re.test(l))bad.push(j.name+'@'+j.version+' '+l)}catch{}}}}",
    "console.log([...new Set(bad)].concat('TOTAL '+total).join('\\n'))",
  ].join("");
  const r = await sandbox(dir, `node -e "${js}"`, { network: "none", env: {} });
  return r.tail.split("\n").filter(Boolean);
}
