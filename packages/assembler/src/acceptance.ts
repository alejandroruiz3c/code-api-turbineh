import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";

/**
 * Acceptance criteria → tests (ADR-0033), generic for every recipe and component. Each recipe or native component
 * may ship `acceptance.yaml`: a list of `{ test, covers }` where `covers` is a list of case-insensitive regular
 * expressions that must all match a criterion's text. Matching is code, never a model. A criterion is:
 *   - "met"     when a test covers it and the verification gate (unit + E2E) passed;
 *   - "covered" when a test covers it but the gate has not run (or failed);
 *   - "open"    when nothing in the package proves it: the coding agent knows exactly what is left.
 */
export interface CoverageRule {
  /** "tests/e2e/file.spec.ts › test title" (or a unit test file). */
  test: string;
  covers: string[];
  /** Where the rule comes from (recipe or component id). */
  from?: string;
}

export interface CriterionStatus {
  criterion: string;
  status: "met" | "covered" | "open";
  tests: string[];
}

export function readCoverage(file: string, from: string): CoverageRule[] {
  if (!existsSync(file)) return [];
  const raw = parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (r): r is { test: string; covers: string[] } =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as { test?: unknown }).test === "string" &&
        Array.isArray((r as { covers?: unknown }).covers),
    )
    .map((r) => ({ test: r.test, covers: r.covers.map(String), from }));
}

const matches = (criterion: string, rule: CoverageRule) =>
  rule.covers.length > 0 &&
  rule.covers.every((re) => {
    try {
      return new RegExp(re, "i").test(criterion);
    } catch {
      return false;
    }
  });

export function acceptanceStatus(
  criteria: readonly string[],
  rules: readonly CoverageRule[],
  gatePassed: boolean | null = null,
): CriterionStatus[] {
  return criteria.map((criterion) => {
    const tests = [...new Set(rules.filter((r) => matches(criterion, r)).map((r) => r.test))];
    return {
      criterion,
      tests,
      status: tests.length === 0 ? "open" : gatePassed ? "met" : "covered",
    };
  });
}

/** Markdown section for AGENTS.md / ACCEPTANCE.md: one line per criterion with its status and proof. */
export function acceptanceSection(statuses: readonly CriterionStatus[]): string {
  const icon = { met: "met", covered: "covered (gate not run)", open: "OPEN" };
  const open = statuses.filter((s) => s.status === "open").length;
  return [
    "## Acceptance criteria",
    "",
    open === 0
      ? "Every criterion is proved by a test in this package."
      : `${open} of ${statuses.length} criteria are open: nothing in the package proves them yet. Start there.`,
    "",
    "| Criterion | Status | Proved by |",
    "| --- | --- | --- |",
    ...statuses.map(
      (s) =>
        `| ${s.criterion.replace(/\|/g, "/")} | ${icon[s.status]} | ${s.tests.map((t) => `\`${t}\``).join("<br>") || "—"} |`,
    ),
    "",
  ].join("\n");
}

const JSON_PATH = ".turbineh/acceptance.json";

/** Writes ACCEPTANCE.md and .turbineh/acceptance.json into the app. */
export function writeAcceptance(outDir: string, statuses: readonly CriterionStatus[]): void {
  mkdirSync(dirname(join(outDir, JSON_PATH)), { recursive: true });
  writeFileSync(join(outDir, JSON_PATH), `${JSON.stringify(statuses, null, 2)}\n`);
  writeFileSync(
    join(outDir, "ACCEPTANCE.md"),
    `<!-- turbineh:generated -->\n# Acceptance\n\n${acceptanceSection(statuses)}`,
  );
}

/** After verification: "covered" becomes "met" when the gate passed (statuses re-read from the app). */
export function finalizeAcceptance(outDir: string, gatePassed: boolean): CriterionStatus[] {
  const file = join(outDir, JSON_PATH);
  if (!existsSync(file)) return [];
  const prev = JSON.parse(readFileSync(file, "utf8")) as CriterionStatus[];
  const next = prev.map((s) =>
    s.tests.length === 0 ? s : { ...s, status: gatePassed ? ("met" as const) : ("covered" as const) },
  );
  writeAcceptance(outDir, next);
  return next;
}
