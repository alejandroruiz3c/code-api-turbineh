import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { findingFix } from "./fixes.js";
import {
  BLOCKING_LICENSE,
  gateFindings,
  labelFindings,
  licenseBlocks,
  osvScan,
  parseSemgrep,
  RULES_DIR,
  RULES_FILE,
  SEMGREP_VERSION,
  semgrepDockerArgs,
  semgrepScanArgs,
  type GateFinding,
  type VerifyResult,
} from "./verify.js";

/**
 * Local gate (ADR-0040 G4c, `turbineh verify --full`): the gate's security and policy checks on a developer's or
 * coding agent's machine, with the gate's pinned versions and rules. Nothing leaves the machine except package
 * coordinates (name@version) sent to OSV; the scanners run in containers without network and with read-only mounts.
 * Without Docker it uses local binaries of exactly the pinned versions, else the check is reported as not run (never
 * as clean). Findings have the gate's shape (`GateFinding`) and its categories: security / policy / quality.
 */

export const GITLEAKS_VERSION = "8.30.1";
export const GITLEAKS_IMAGE =
  "ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f";

export type LocalCheckName = "env-literals" | "secrets" | "static" | "dependencies" | "licenses";

export interface LocalCheck {
  name: LocalCheckName;
  /** False when the check could not run here (no Docker and no pinned binary, offline…): never counted as clean. */
  ran: boolean;
  /** How it ran: "docker gitleaks 8.30.1", "local semgrep 1.178.0", "osv.dev (package coordinates only)"… */
  via: string;
  ms: number;
  /** What it covered, or why it did not run and how to make it run. */
  detail: string;
}

export interface LocalGateResult {
  /** Every check ran and nothing blocks. */
  ok: boolean;
  /** Every check ran. */
  complete: boolean;
  checks: LocalCheck[];
  findings: GateFinding[];
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (cmd: string, args: string[], timeoutMs?: number) => Promise<ExecResult>;

export interface LocalGateOptions {
  /** Process runner (tests inject one). */
  exec?: Exec;
  /** OSV transport (tests inject one). */
  fetch?: typeof fetch;
  /** Semgrep rules text; the CLI bundle embeds `turbineh-security.yml`. Default: the verifier's rules folder. */
  rulesYaml?: string;
  /** Skip OSV (no network). The dependency check is then reported as not run. */
  offline?: boolean;
}

/** spawn without a shell; stdout and stderr apart (gitleaks writes its JSON report to stdout, logs to stderr). */
export const exec: Exec = (cmd, args, timeoutMs = 10 * 60_000) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-20_000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

// ── src/env.ts: secret-shaped literals (tool-free, G4b) ─────────────────────────────────────────────────────────

const SECRET_NAME = /(secret|password|passwd|api_?key|token|private_?key)/i;
/** The value shape the gate's `turbineh.hardcoded-secret` rule matches. */
const GATE_VALUE = /^[A-Za-z0-9_+/=-]{16,}$/;

export interface EnvLiteral {
  line: number;
  key: string;
  /** The gate's Semgrep rule flags the same literal (`KEY: "value"`): it blocks there too. */
  gateRule: boolean;
  why: string;
}

/**
 * Secret-shaped literals in `src/env.ts` (ADR-0040 G4b): a value or default for a setting named like a secret, or a
 * connection URL with a password. Deterministic and tool-free, so the default `turbineh verify` catches the
 * learning-round mistake (`BETTER_AUTH_SECRET: "build-placeholder-…"`) before the gate does. Values are never printed.
 */
export function envSecretLiterals(src: string): EnvLiteral[] {
  const out: EnvLiteral[] = [];
  let key = "";
  src.split("\n").forEach((text, i) => {
    const line = text.replace(/(^|\s)\/\/.*$/, "");
    if (/^\s*(\*|\/\*)/.test(text)) return;
    const k = /^\s*([A-Z][A-Z0-9_]*)\s*:/.exec(line);
    if (k?.[1]) key = k[1];
    const literal = (re: RegExp) =>
      [...line.matchAll(re)].map((m) => [m[1] ?? "", m[2] ?? ""] as const);
    // KEY: "value" (object literal, the gate rule's shape) and const key = "value".
    for (const [name, value] of [
      ...literal(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*["'`]([^"'`$]*)["'`]/g),
      ...literal(/\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["'`]([^"'`$]*)["'`]/g),
    ]) {
      if (!value || /^\d+$/.test(value)) continue;
      if (SECRET_NAME.test(name))
        out.push({
          line: i + 1,
          key: name,
          gateRule: GATE_VALUE.test(value),
          why: "a literal value",
        });
      else if (/:\/\/[^/\s:@]+:[^@/\s]+@/.test(value))
        out.push({ line: i + 1, key: name, gateRule: false, why: "a URL with a password" });
    }
    // KEY: z.string().default("value") and process.env.KEY ?? "value" / || "value".
    for (const m of line.matchAll(/\.default\(\s*["'`]([^"'`$]+)["'`]/g))
      if (SECRET_NAME.test(key) && m[1] && !/^\d+$/.test(m[1]))
        out.push({ line: i + 1, key, gateRule: false, why: "a default value" });
    for (const m of line.matchAll(
      /process\.env\.([A-Z][A-Z0-9_]*)\s*(?:\?\?|\|\|)\s*["'`]([^"'`$]+)["'`]/g,
    ))
      if (m[1] && SECRET_NAME.test(m[1]))
        out.push({ line: i + 1, key: m[1], gateRule: false, why: "a fallback value" });
  });
  return out;
}

export function envLiteralFindings(dir: string): GateFinding[] {
  const file = join(dir, "src/env.ts");
  if (!existsSync(file)) return [];
  return envSecretLiterals(readFileSync(file, "utf8")).map((l) => ({
    category: "policy",
    rule: l.gateRule ? "turbineh.hardcoded-secret" : "turbineh.env-secret-literal",
    where: `src/env.ts:${l.line}`,
    blocking: l.gateRule,
    message: `${l.key} has ${l.why} in src/env.ts (value not shown)${l.gateRule ? "; the gate blocks it (turbineh.hardcoded-secret)" : ""}.`,
    fix: findingFix("turbineh.env-secret-literal"),
  }));
}

// ── Licences: in-process read of installed package.json files (the gate's policy) ──────────────────────────────

/**
 * Every installed package's licence (pnpm's `node_modules/.pnpm`, else a flat `node_modules`), the gate's regex and SPDX
 * semantics. Reads JSON only; runs nothing. Null when nothing is installed.
 */
export function licenceScan(dir: string): { total: number; blocking: string[] } | null {
  const pnpm = join(dir, "node_modules/.pnpm");
  const roots = existsSync(pnpm)
    ? readdirSync(pnpm).map((d) => join(pnpm, d, "node_modules"))
    : existsSync(join(dir, "node_modules"))
      ? [join(dir, "node_modules")]
      : [];
  if (roots.length === 0) return null;
  let total = 0;
  const blocking = new Set<string>();
  for (const nm of roots) {
    if (!existsSync(nm)) continue;
    for (const a of readdirSync(nm)) {
      if (a.startsWith(".")) continue;
      const names = a.startsWith("@") ? readdirSync(join(nm, a)).map((b) => `${a}/${b}`) : [a];
      for (const n of names) {
        try {
          const j = JSON.parse(readFileSync(join(nm, n, "package.json"), "utf8")) as {
            name?: string;
            version?: string;
            license?: string | { type?: string };
          };
          total++;
          const l = typeof j.license === "string" ? j.license : (j.license?.type ?? "UNKNOWN");
          if (BLOCKING_LICENSE.test(l) && licenseBlocks(l))
            blocking.add(`${j.name}@${j.version} ${l}`);
        } catch {
          // not a package folder
        }
      }
    }
  }
  return { total, blocking: [...blocking].sort() };
}

// ── gitleaks: git history + the files git would commit (working tree) ──────────────────────────────────────────

interface GitleaksHit {
  RuleID: string;
  Description: string;
  File: string;
  StartLine: number;
  Commit?: string;
}

/** gitleaks JSON report → hits (redacted by gitleaks; only rule, file, line and commit are kept). Null if invalid. */
export function parseGitleaks(stdout: string): GitleaksHit[] | null {
  const start = stdout.indexOf("[");
  if (start < 0) return null;
  try {
    const data = JSON.parse(stdout.slice(start)) as unknown;
    if (!Array.isArray(data)) return null;
    return data.map((h: GitleaksHit) => ({
      RuleID: String(h.RuleID),
      Description: String(h.Description ?? h.RuleID),
      File: String(h.File),
      StartLine: Number(h.StartLine),
      ...(h.Commit ? { Commit: String(h.Commit) } : {}),
    }));
  } catch {
    return null;
  }
}

const GITLEAKS_FLAGS = [
  "--redact",
  "--no-banner",
  "--log-level",
  "error",
  "--report-format",
  "json",
  "--report-path",
  "-",
  "--exit-code",
  "0",
];

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".turbo"]);

function walkFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walkFiles(p, base);
    return e.isFile() ? [relative(base, p)] : [];
  });
}

/** Files git would commit: tracked plus untracked-not-ignored (falls back to a walk without build output). */
async function candidateFiles(dir: string, run: Exec): Promise<string[]> {
  if (existsSync(join(dir, ".git"))) {
    const r = await run("git", ["-C", dir, "ls-files", "-co", "--exclude-standard", "-z"], 60_000);
    if (r.code === 0) return r.stdout.split("\0").filter(Boolean);
  }
  return walkFiles(dir);
}

type Tool = {
  via: string;
  args: (args: string[], mounts: [string, string][]) => [string, string[]];
};

async function gitleaksTool(docker: boolean, run: Exec): Promise<Tool | null> {
  if (docker)
    return {
      via: `docker gitleaks ${GITLEAKS_VERSION}`,
      args: (args, mounts) => [
        "docker",
        [
          "run",
          "--rm",
          "--network",
          "none",
          ...mounts.flatMap(([host, inside]) => ["-v", `${host}:${inside}:ro`]),
          GITLEAKS_IMAGE,
          ...args,
        ],
      ],
    };
  const v = await run("gitleaks", ["version"], 30_000);
  if (v.code === 0 && v.stdout.trim().replace(/^v/, "") === GITLEAKS_VERSION)
    return {
      via: `local gitleaks ${GITLEAKS_VERSION}`,
      args: (args, mounts) => {
        // Same command, host paths instead of container paths.
        const real = args.map((a) => mounts.find(([, inside]) => inside === a)?.[0] ?? a);
        return ["gitleaks", real];
      },
    };
  return null;
}

async function secretsCheck(
  dir: string,
  docker: boolean,
  run: Exec,
): Promise<{ check: LocalCheck; findings: GateFinding[] }> {
  const t = performance.now();
  const ms = () => Math.round(performance.now() - t);
  const tool = await gitleaksTool(docker, run);
  if (!tool)
    return {
      check: {
        name: "secrets",
        ran: false,
        via: "",
        ms: ms(),
        detail: `Not run: needs Docker (image ${GITLEAKS_IMAGE.split("@")[0]}) or gitleaks ${GITLEAKS_VERSION} on PATH (https://github.com/gitleaks/gitleaks/releases/tag/v${GITLEAKS_VERSION}).`,
      },
      findings: [],
    };
  const hits = new Map<string, GateFinding>();
  const add = (h: GitleaksHit, prefix: string, committed: boolean) => {
    const file = h.File.replace(prefix, "");
    const where = `${file}:${h.StartLine}`;
    if (hits.has(`${where}:${h.RuleID}`)) return;
    hits.set(`${where}:${h.RuleID}`, {
      category: "security",
      rule: "gitleaks",
      where,
      blocking: true,
      message: `${h.Description} (gitleaks rule ${h.RuleID}; ${committed && h.Commit ? `in commit ${h.Commit.slice(0, 7)}` : "not committed yet"}; value redacted).`,
      fix: findingFix("gitleaks"),
    });
  };
  let scanned = 0;
  // 1. The git history, as the gate scans it at delivery.
  if (existsSync(join(dir, ".git"))) {
    const [cmd, args] = tool.args(["git", "/src", ...GITLEAKS_FLAGS], [[dir, "/src"]]);
    const r = await run(cmd, args, 5 * 60_000);
    const parsed = r.code === 0 ? parseGitleaks(r.stdout) : null;
    if (!parsed)
      return {
        check: {
          name: "secrets",
          ran: false,
          via: tool.via,
          ms: ms(),
          detail: `gitleaks gave no valid report on the git history (exit ${r.code}).`,
        },
        findings: [],
      };
    for (const h of parsed) add(h, /^\/src\//.test(h.File) ? "/src/" : `${dir}/`, true);
    scanned++;
  }
  // 2. What the next commit would add: tracked and untracked, not ignored (copied to a temporary folder).
  const files = await candidateFiles(dir, run);
  const tmp = mkdtempSync(join(tmpdir(), "turbineh-gitleaks-"));
  try {
    for (const f of files) {
      const src = join(dir, f);
      try {
        const st = lstatSync(src);
        if (!st.isFile() || st.size > 5_000_000) continue;
      } catch {
        continue;
      }
      mkdirSync(dirname(join(tmp, f)), { recursive: true });
      copyFileSync(src, join(tmp, f));
    }
    const [cmd, args] = tool.args(["dir", "/scan", ...GITLEAKS_FLAGS], [[tmp, "/scan"]]);
    const r = await run(cmd, args, 5 * 60_000);
    const parsed = r.code === 0 ? parseGitleaks(r.stdout) : null;
    if (!parsed)
      return {
        check: {
          name: "secrets",
          ran: false,
          via: tool.via,
          ms: ms(),
          detail: `gitleaks gave no valid report on the working tree (exit ${r.code}).`,
        },
        findings: [],
      };
    for (const h of parsed) add(h, /^\/scan\//.test(h.File) ? "/scan/" : `${tmp}/`, false);
    scanned++;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return {
    check: {
      name: "secrets",
      ran: true,
      via: tool.via,
      ms: ms(),
      detail: `${scanned === 2 ? "git history and " : ""}${files.length} files of the working tree (values redacted)`,
    },
    findings: [...hits.values()],
  };
}

// ── Semgrep: the gate's rules and image ─────────────────────────────────────────────────────────────────────────

async function staticCheck(
  dir: string,
  docker: boolean,
  run: Exec,
  rulesYaml: string | undefined,
): Promise<{ check: LocalCheck; findings: GateFinding[] }> {
  const t = performance.now();
  const ms = () => Math.round(performance.now() - t);
  let rulesDir = RULES_DIR;
  let tmp: string | null = null;
  if (rulesYaml !== undefined) {
    tmp = mkdtempSync(join(tmpdir(), "turbineh-rules-"));
    writeFileSync(join(tmp, RULES_FILE), rulesYaml);
    rulesDir = tmp;
  }
  try {
    let via = "";
    let r: ExecResult | null = null;
    if (docker) {
      via = `docker semgrep ${SEMGREP_VERSION}`;
      r = await run("docker", semgrepDockerArgs(dir, rulesDir), 10 * 60_000);
    } else {
      const v = await run("semgrep", ["--version"], 60_000);
      if (v.code === 0 && v.stdout.trim() === SEMGREP_VERSION) {
        via = `local semgrep ${SEMGREP_VERSION}`;
        r = await run("semgrep", semgrepScanArgs(join(rulesDir, RULES_FILE), dir), 10 * 60_000);
      }
    }
    if (!r)
      return {
        check: {
          name: "static",
          ran: false,
          via: "",
          ms: ms(),
          detail: `Not run: needs Docker (image semgrep/semgrep:${SEMGREP_VERSION}) or semgrep ${SEMGREP_VERSION} on PATH (pipx install semgrep==${SEMGREP_VERSION}).`,
        },
        findings: [],
      };
    const parsed = parseSemgrep(r.stdout.replaceAll(`${dir}/`, ""));
    if (!parsed)
      return {
        check: {
          name: "static",
          ran: false,
          via,
          ms: ms(),
          detail: `Semgrep gave no valid result (exit ${r.code}).`,
        },
        findings: [],
      };
    const labelled = labelFindings(dir, parsed);
    return {
      check: {
        name: "static",
        ran: true,
        via,
        ms: ms(),
        detail: `${labelled.length} finding(s) with the TurbineH rules (tests/ excluded, as in the gate)`,
      },
      findings: findingsOf({ static: labelled }),
    };
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

/** The gate's own mapping (same categories, blocking and fix) for static findings, advisories and licences. */
function findingsOf(f: Partial<VerifyResult["findings"]>): GateFinding[] {
  return gateFindings({
    ok: false,
    steps: [],
    findings: { secrets: 0, advisories: [], licenses: [], static: [], ...f },
    scannedAt: "",
  });
}

// ── The local gate ──────────────────────────────────────────────────────────────────────────────────────────────

export async function localGate(
  dir: string,
  opts: LocalGateOptions = {},
): Promise<LocalGateResult> {
  const run = opts.exec ?? exec;
  const docker =
    (await run("docker", ["info", "--format", "{{.ServerVersion}}"], 30_000)).code === 0;

  // Early and tool-free: secret-shaped literals in src/env.ts (the G4b pattern).
  const t0 = performance.now();
  const envFindings = envLiteralFindings(dir);
  const envCheck: LocalCheck = {
    name: "env-literals",
    ran: true,
    via: "in-process",
    ms: Math.round(performance.now() - t0),
    detail: existsSync(join(dir, "src/env.ts")) ? "src/env.ts" : "no src/env.ts",
  };

  const deps = (async (): Promise<{ check: LocalCheck; findings: GateFinding[] }> => {
    const t = performance.now();
    const base = { name: "dependencies" as const, via: "osv.dev (package name@version only)" };
    if (opts.offline)
      return {
        check: {
          ...base,
          ran: false,
          ms: 0,
          detail: "Not run: --offline (OSV needs the network).",
        },
        findings: [],
      };
    if (!existsSync(join(dir, "pnpm-lock.yaml")))
      return {
        check: {
          ...base,
          ran: false,
          ms: 0,
          detail: "Not run: no pnpm-lock.yaml (the gate reads it).",
        },
        findings: [],
      };
    try {
      const advisories = await osvScan(dir, opts.fetch ?? fetch);
      return {
        check: {
          ...base,
          ran: true,
          ms: Math.round(performance.now() - t),
          detail: `${advisories.length} advisory(ies); only production HIGH/CRITICAL block`,
        },
        findings: findingsOf({ advisories }),
      };
    } catch (err) {
      return {
        check: {
          ...base,
          ran: false,
          ms: Math.round(performance.now() - t),
          detail: `Not run: OSV unreachable (${err instanceof Error ? err.message : String(err)}).`,
        },
        findings: [],
      };
    }
  })();

  const licences = (() => {
    const t = performance.now();
    const scan = licenceScan(dir);
    const check: LocalCheck = {
      name: "licenses",
      ran: scan !== null,
      via: "in-process (installed package.json files)",
      ms: Math.round(performance.now() - t),
      detail: scan
        ? `${scan.total} installed packages`
        : "Not run: no node_modules; run `pnpm install` first (the policy reads installed licences).",
    };
    return { check, findings: scan ? findingsOf({ licenses: scan.blocking }) : [] };
  })();

  const [secrets, statics, advisories] = await Promise.all([
    secretsCheck(dir, docker, run),
    staticCheck(dir, docker, run, opts.rulesYaml),
    deps,
  ]);
  const checks = [envCheck, secrets.check, statics.check, advisories.check, licences.check];
  // One finding per rule and place: the env check and Semgrep may both report the same literal.
  const seen = new Set<string>();
  const findings = [
    ...envFindings,
    ...secrets.findings,
    ...statics.findings,
    ...advisories.findings,
    ...licences.findings,
  ].filter((f) => {
    const k = `${f.rule}|${f.where}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const complete = checks.every((c) => c.ran);
  return { ok: complete && !findings.some((f) => f.blocking), complete, checks, findings };
}
