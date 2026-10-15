import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Gate reports shipped inside the delivered package (ADR-0055, audit F19): what ran, how long, why a step shows no
 * time or did not run, the static findings as SARIF, the dependency list and, when the test runners produced them,
 * JUnit files. Everything is written by code from the gate's own results; nothing here is decided by a model.
 */
export const REPORTS_DIR = ".turbineh/reports";

/** Every step of the full gate, in order (the sandbox steps, then the scans). */
export const GATE_STEPS = [
  "install",
  "migrations",
  "lint",
  "typecheck",
  "unit",
  "build",
  "e2e",
  "secrets",
  "static",
  "dependencies",
  "licenses",
] as const;

const SANDBOX_ORDER = ["install", "migrations", "lint", "typecheck", "unit", "build", "e2e"];

export interface ExplainedStep {
  name: string;
  ok: boolean;
  ms: number;
  /** Why the time is what it is (0 ms or near zero), so no step is left unexplained. */
  note?: string;
}

export interface SkippedStep {
  name: string;
  reason: string;
}

/** Deterministic note per step: why it shows no (or a shared) duration. */
export function stepNote(
  step: { name: string; ms: number },
  ctx: { installFromBase?: boolean } = {},
): string | undefined {
  switch (step.name) {
    case "install":
      return ctx.installFromBase
        ? "Dependencies were pre-installed in the sandbox base image keyed by the lockfile hash; only copying the source is timed."
        : undefined;
    case "static":
    case "dependencies":
      return "Read-only scan run concurrently with the sandbox steps; the time is the shared duration of the scans (Semgrep, OSV).";
    case "licenses":
      return "Read from the installed dependency tree right after install, inside the sandbox; not timed separately.";
    case "secrets":
      return step.ms === 0
        ? "gitleaks over the tracked files, run concurrently with the sandbox steps."
        : undefined;
    default:
      return step.ms === 0 ? "Finished in under a millisecond." : undefined;
  }
}

/** Gate steps that did not run, each with the reason (an earlier sandbox step failed, or the sandbox stopped). */
export function skippedSteps(steps: { name: string; ok: boolean }[]): SkippedStep[] {
  const ran = new Set(steps.map((s) => s.name));
  const firstFailed = SANDBOX_ORDER.find((n) => steps.some((s) => s.name === n && !s.ok));
  return GATE_STEPS.filter((n) => !ran.has(n)).map((name) => ({
    name,
    reason: firstFailed
      ? `Not run: the sandbox stops at the first failing step (${firstFailed}).`
      : "Not run: the sandbox stopped before this step (see the install step).",
  }));
}

interface SarifFinding {
  rule: string;
  severity: "ERROR" | "WARNING";
  path: string;
  line: number;
  message: string;
}

/** SARIF 2.1.0 of the static findings (TurbineH Semgrep rules), for code-scanning tools. */
export function toSarif(findings: SarifFinding[], toolVersion: string): unknown {
  const rules = [...new Set(findings.map((f) => f.rule))].sort();
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Semgrep (TurbineH rules)",
            version: toolVersion,
            informationUri: "https://semgrep.dev",
            rules: rules.map((id) => ({ id })),
          },
        },
        results: findings.map((f) => ({
          ruleId: f.rule,
          level: f.severity === "ERROR" ? "error" : "warning",
          message: { text: f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.path },
                region: { startLine: Math.max(1, f.line) },
              },
            },
          ],
        })),
      },
    ],
  };
}

export interface DependencyEntry {
  name: string;
  version: string;
  purl: string;
  scope: "production" | "development";
}

/** Dependency list from the lockfile keys (`name@version`), production scope from the closure of the app's deps. */
export function dependencyList(packageKeys: string[], production: Set<string>): DependencyEntry[] {
  const out = new Map<string, DependencyEntry>();
  for (const raw of packageKeys) {
    const key = raw.split("(")[0] ?? raw;
    const at = key.lastIndexOf("@");
    if (at <= 0) continue;
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    out.set(key, {
      name,
      version,
      purl: `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`,
      scope: production.has(key) ? "production" : "development",
    });
  }
  return [...out.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

export interface GateReportInput {
  ok: boolean;
  scannedAt: string;
  steps: ExplainedStep[];
  skipped: SkippedStep[];
  findings: {
    secrets: number;
    advisories: { id: string; pkg: string; severity: string; scope: string }[];
    licenses: string[];
    static: SarifFinding[];
  };
  dependencies: DependencyEntry[];
  semgrepVersion: string;
}

/** Writes gate.json, static.sarif and dependencies.json under REPORTS_DIR. Returns the relative paths written. */
export function writeGateReports(dir: string, input: GateReportInput): string[] {
  const out = join(dir, REPORTS_DIR);
  mkdirSync(out, { recursive: true });
  const files: [string, unknown][] = [
    [
      "gate.json",
      {
        ok: input.ok,
        scannedAt: input.scannedAt,
        environment: "TurbineH sandbox: no internet, ephemeral Postgres, service mocks",
        steps: input.steps,
        skipped: input.skipped,
        findings: {
          secrets: input.findings.secrets,
          advisories: input.findings.advisories,
          licenses: input.findings.licenses,
          static: input.findings.static.length,
        },
        reports: {
          static: "static.sarif",
          dependencies: "dependencies.json",
          junit: ["unit.junit.xml", "e2e.junit.xml"],
          note: "JUnit files are present when the test runners produced them (the step ran).",
        },
      },
    ],
    ["static.sarif", toSarif(input.findings.static, input.semgrepVersion)],
    [
      "dependencies.json",
      {
        format: "turbineh.dependencies/v1",
        source: "pnpm-lock.yaml",
        note: "Dependency list from the lockfile (no CycloneDX generator runs in the sandbox). Scope: production = reachable from the app's dependencies.",
        components: input.dependencies,
      },
    ],
  ];
  for (const [name, body] of files)
    writeFileSync(join(out, name), `${JSON.stringify(body, null, 2)}\n`);
  return files.map(([name]) => `${REPORTS_DIR}/${name}`);
}
