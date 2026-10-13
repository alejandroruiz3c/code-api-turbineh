import { failureLocation, gateFindings, type StepName, type VerifyResult } from "./verify.js";

/**
 * One failing check, read deterministically from the gate output (ADR-0037): the step, the failing test (title and
 * file:line) when the step runs tests, and the first error line. Never decided by a model.
 */
export interface GateFailure {
  step: StepName;
  /** Test title as the runner prints it ("describe › title"), or null for lint/typecheck/build failures. */
  test: string | null;
  file: string | null;
  line: number | null;
  message: string;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const QUALITY: StepName[] = ["install", "migrations", "lint", "typecheck", "unit", "build", "e2e"];
const FILE = String.raw`((?:tests|src|scripts)\/[\w./[\]@-]+\.[cm]?[jt]sx?)`;

/** Playwright: "  1) [chromium] › tests/e2e/a.spec.ts:174:7 › Suite › title ───" (also the end-of-run summary). */
const PLAYWRIGHT = new RegExp(
  String.raw`^\s*(?:\d+\)\s+)?(?:\[[^\]]+\]\s+›\s+)?` +
    FILE +
    String.raw`:(\d+):\d+\s+›\s+(.+?)\s*[─-]*\s*$`,
);
/** Vitest: " FAIL  tests/unit/a.test.ts > Suite > title" + " ❯ tests/unit/a.test.ts:12:5". */
const VITEST_FAIL = new RegExp(String.raw`^\s*FAIL\s+` + FILE + String.raw`\s+>\s+(.+?)\s*$`);
const VITEST_AT = new RegExp(String.raw`❯\s+` + FILE + String.raw`:(\d+)`);
const ERROR_LINE =
  /^\s*((?:Error|AssertionError|TypeError|ReferenceError|SyntaxError)\b.*|.*error TS\d+:.*|\s*\d+:\d+\s+error\s+.*)$/;

function firstError(lines: string[], from = 0): string {
  for (let i = from; i < lines.length; i++) {
    const m = ERROR_LINE.exec(lines[i] ?? "");
    if (m?.[1]) return m[1].trim().slice(0, 300);
  }
  return "";
}

/** Every failing quality step with its first failing test (or file:line) and message. */
export function gateFailures(v: VerifyResult): GateFailure[] {
  const out: GateFailure[] = [];
  for (const s of v.steps) {
    if (s.ok || !QUALITY.includes(s.name)) continue;
    const lines = s.detail.replace(ANSI, "").split("\n");
    const found: GateFailure[] = [];
    const seen = new Set<string>();
    lines.forEach((l, i) => {
      if (s.name === "e2e") {
        const m = PLAYWRIGHT.exec(l);
        if (m?.[1] && m[3] && !seen.has(`${m[1]}:${m[3]}`)) {
          seen.add(`${m[1]}:${m[3]}`);
          found.push({
            step: s.name,
            test: m[3].replace(/\s*\(retry #\d+\)$/, ""),
            file: m[1],
            line: Number(m[2]),
            message: firstError(lines, i + 1),
          });
        }
      } else if (s.name === "unit") {
        const m = VITEST_FAIL.exec(l);
        if (m?.[1] && m[2] && !seen.has(`${m[1]}:${m[2]}`)) {
          seen.add(`${m[1]}:${m[2]}`);
          const at = lines
            .slice(i + 1)
            .map((x) => VITEST_AT.exec(x))
            .find((x) => x?.[1] === m[1]);
          found.push({
            step: s.name,
            test: m[2],
            file: m[1],
            line: at?.[2] ? Number(at[2]) : null,
            message: firstError(lines, i + 1),
          });
        }
      }
    });
    if (found.length === 0) {
      const where = failureLocation(s.detail.replace(ANSI, ""));
      const [file = null, line = null] = where
        ? [where.split(":")[0] ?? null, where.split(":")[1]]
        : [];
      found.push({
        step: s.name,
        test: null,
        file,
        line: line ? Number(line) : null,
        message: firstError(lines) || `${s.name} failed`,
      });
    }
    out.push(...found);
  }
  return out;
}

/** The last segment of a runner title ("Suite › title" → "title"), for `-g` / `-t` filters. */
export const testTitle = (test: string) => test.split(/\s+[›>]\s+/).at(-1) ?? test;

/** The cheapest command that reproduces one failure in the delivered package (no setup needed, ADR-0035). */
export function rerunCommand(f: GateFailure): string {
  const q = (s: string) => `"${testTitle(s).replace(/(["\\$`])/g, "\\$1")}"`;
  switch (f.step) {
    case "e2e":
      return f.file && f.test ? `pnpm test:e2e ${f.file} -g ${q(f.test)}` : "pnpm test:e2e";
    case "unit":
      return f.file ? `pnpm test ${f.file}${f.test ? ` -t ${q(f.test)}` : ""}` : "pnpm test";
    case "typecheck":
      return "pnpm typecheck";
    case "lint":
      return "pnpm lint";
    case "build":
      return "pnpm build";
    case "migrations":
      return "pnpm db:generate && pnpm db:migrate";
    default:
      return "pnpm install";
  }
}

/**
 * What a finished build delivers (ADR-0037 §D1), decided by code from the gate result only:
 *  - verified: every check passed;
 *  - unverified: only quality checks failed (install, migrations, lint, types, tests, build) — the package is
 *    delivered, marked `verified: false`, with the exact failure and the fix;
 *  - report_only: a security or policy check blocks (secrets, static security errors, blocking advisories, licences)
 *    or did not report — no runnable code leaves the sandbox, only the report.
 */
export type DeliveryKind = "verified" | "unverified" | "report_only";

export const SECURITY_STEPS: StepName[] = ["secrets", "static", "dependencies", "licenses"];

export function deliveryKind(v: VerifyResult): DeliveryKind {
  if (v.ok && v.steps.length > 0) return "verified";
  const securityStepFailed = v.steps.some((s) => !s.ok && SECURITY_STEPS.includes(s.name));
  const securityFinding = gateFindings(v).some((f) => f.blocking && f.category !== "quality");
  // Fail closed: a security scan that did not report counts as blocking.
  const scanned = SECURITY_STEPS.every((n) => v.steps.some((s) => s.name === n));
  return securityStepFailed || securityFinding || !scanned ? "report_only" : "unverified";
}
