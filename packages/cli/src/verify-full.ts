import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findingFix,
  localGate,
  type GateFinding,
  type LocalCheck,
  type LocalGateOptions,
  type LocalGateResult,
} from "@turbineh/verifier";
import { bold, dim, green, red, yellow, type CommandResult } from "./output.js";
import { firstError, locate } from "./package-guide.js";

/** The gate's Semgrep rules, embedded by scripts/bundle.ts (undefined when run from source: the rules folder is read). */
declare const __TURBINEH_SEMGREP_RULES__: string | undefined;
const embeddedRules = () =>
  typeof __TURBINEH_SEMGREP_RULES__ !== "undefined" ? __TURBINEH_SEMGREP_RULES__ : undefined;

/** A local-gate check or one of the project's own scripts (typecheck, lint, test). */
export type FullCheck = Omit<LocalCheck, "name"> & { name: string };

export type ScriptRunner = (cmd: string, args: string[]) => { ok: boolean; detail: string };

const runScript =
  (cwd: string): ScriptRunner =>
  (cmd, args) => {
    try {
      execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: 15 * 60_000 });
      return { ok: true, detail: "" };
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      return { ok: false, detail: `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}` };
    }
  };

/** typecheck, lint and unit tests of the project (its own scripts), as quality findings in the gate's shape. */
function qualityChecks(
  cwd: string,
  run: ScriptRunner,
): { checks: FullCheck[]; findings: GateFinding[] } {
  const pkgPath = join(cwd, "package.json");
  const scripts = existsSync(pkgPath)
    ? ((JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> })
        .scripts ?? {})
    : {};
  const pm = existsSync(join(cwd, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(join(cwd, "yarn.lock"))
      ? "yarn"
      : "npm";
  const checks: FullCheck[] = [];
  const findings: GateFinding[] = [];
  for (const name of ["typecheck", "lint", "test"] as const) {
    if (!scripts[name]) continue;
    const t = performance.now();
    const r = run(pm, pm === "pnpm" ? ["-s", name] : ["run", name]);
    checks.push({
      name,
      ran: true,
      via: `${pm} ${name}`,
      ms: Math.round(performance.now() - t),
      detail: r.ok ? "passed" : "failed",
    });
    if (!r.ok)
      findings.push({
        category: "quality",
        rule: name === "test" ? "unit" : name,
        where: locate(r.detail) ?? name,
        blocking: true,
        message: firstError(r.detail).slice(0, 300) || `${name} failed`,
        fix: findingFix(name),
      });
  }
  return { checks, findings };
}

/**
 * `turbineh verify --full` (ADR-0040 G4c): the gate's security and policy checks here — gitleaks 8.30.1, the TurbineH
 * Semgrep rules on Semgrep 1.178.0, OSV and the licence policy — plus the project's typecheck, lint and unit tests.
 * Docker first (pinned images, no network, read-only); else local binaries of exactly those versions; else the check
 * is "not run" and the command fails. No code leaves the machine (OSV receives package name@version only).
 */
export async function verifyFull(
  cwd: string,
  opts: {
    skipScripts?: boolean;
    offline?: boolean;
    gate?: (dir: string, o: LocalGateOptions) => Promise<LocalGateResult>;
    run?: ScriptRunner;
  } = {},
): Promise<CommandResult> {
  const rulesYaml = embeddedRules();
  const gate = await (opts.gate ?? localGate)(cwd, {
    ...(rulesYaml !== undefined ? { rulesYaml } : {}),
    ...(opts.offline ? { offline: true } : {}),
  });
  const quality = opts.skipScripts
    ? { checks: [], findings: [] }
    : qualityChecks(cwd, opts.run ?? runScript(cwd));
  const checks: FullCheck[] = [...gate.checks, ...quality.checks];
  const findings = [...gate.findings, ...quality.findings];
  const blocking = findings.filter((f) => f.blocking);
  const notRun = checks.filter((c) => !c.ran);
  const ok = blocking.length === 0 && notRun.length === 0;
  const state = blocking.length
    ? "blocking_findings"
    : notRun.length
      ? "incomplete"
      : "verified_locally";
  const label = (f: GateFinding) => `[${f.category}]`;
  return {
    ok,
    command: "verify",
    state,
    data: {
      full: true,
      checks,
      findings,
      notRunHere:
        "build and E2E: run `pnpm build && pnpm test:e2e` (the TurbineH gate runs them in its sandbox).",
    },
    lines: [
      bold("Local gate: the TurbineH gate's security and policy checks, same rules and versions"),
      ...checks.map((c) =>
        c.ran
          ? `  ${green("✔")} ${c.name} ${dim(`(${c.via}; ${c.detail})`)}`
          : `  ${yellow("○")} ${c.name} not run — ${c.detail}`,
      ),
      "",
      ...(findings.length ? [bold("Findings:")] : [green("No findings.")]),
      ...findings.map(
        (f) =>
          `  ${f.blocking ? red("✖") : yellow("!")} ${label(f)} ${f.rule} at ${f.where}${f.blocking ? "" : dim(" (not blocking)")} — ${f.message}\n    ${dim(`fix: ${f.fix ?? ""}`)}`,
      ),
    ],
    ...(ok
      ? {
          next: opts.skipScripts
            ? "Security and policy checks pass here (typecheck, lint and unit tests skipped: --skip-scripts). Then `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` before handing over."
            : "Security, policy and quality checks pass here. Then `pnpm build && pnpm test:e2e` before handing over.",
        }
      : blocking.length
        ? {
            error: {
              code: "blocking_findings",
              message: `${blocking.length} blocking finding(s); first: ${blocking[0]?.rule} at ${blocking[0]?.where}.`,
              action: blocking[0]?.fix ?? "Fix it and run turbineh verify --full again.",
              resume: "turbineh verify --full",
            },
          }
        : {
            error: {
              code: "checks_not_run",
              message: `Not run here: ${notRun.map((c) => c.name).join(", ")} (never counted as clean).`,
              action: notRun[0]?.detail ?? "Install Docker and run turbineh verify --full again.",
              resume: "turbineh verify --full",
            },
          }),
  };
}
