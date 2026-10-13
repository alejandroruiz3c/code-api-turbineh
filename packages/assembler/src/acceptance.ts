import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { proofVerdict, proofVeto, type ProofCandidate } from "@turbineh/shared";
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
  /**
   * Generated tests (no hand-written rule): beyond `covers`, the test's title and key assertions must exercise the
   * criterion's subject, action, actor and any negation (`proofVerdict`, precision first).
   */
  proof?: ProofCandidate;
  /**
   * Hand-written rules (acceptance.yaml) checked against the test shipped in the package (ADR-0043): `veto` = its
   * title and assertions must pass the refusal and actor checks (`proofVeto`); `full` = the full proof check, used
   * when the test skips itself on a condition of the app (`test.skip(…)`), so it may prove nothing here.
   */
  check?: "veto" | "full";
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

const matches = (criterion: string, rule: CoverageRule, strict: boolean) => {
  const covered =
    rule.covers.length > 0 &&
    rule.covers.every((re) => {
      try {
        return new RegExp(re, "i").test(criterion);
      } catch {
        return false;
      }
    });
  if (!covered) return false;
  if (!rule.proof) return true;
  // Precision first: generated tests, conditional tests and criteria a missing pattern touches need the full proof.
  if (!rule.check || rule.check === "full" || strict)
    return proofVerdict(criterion, rule.proof).proven;
  return proofVeto(criterion, rule.proof) === "";
};

export function acceptanceStatus(
  criteria: readonly string[],
  rules: readonly CoverageRule[],
  gatePassed: boolean | null = null,
  /** Criteria that only a full proof may mark covered (e.g. a missing domain pattern touches them). */
  strict: (criterion: string) => boolean = () => false,
): CriterionStatus[] {
  return criteria.map((criterion) => {
    const hard = strict(criterion);
    const tests = [...new Set(rules.filter((r) => matches(criterion, r, hard)).map((r) => r.test))];
    return {
      criterion,
      tests,
      status: tests.length === 0 ? "open" : gatePassed ? "met" : "covered",
    };
  });
}

/** Test titles of a spec file with their key assertions and whether they skip themselves on a condition. */
function blocksOf(src: string): { title: string; assertions: string[]; conditional: boolean }[] {
  const starts = [...src.matchAll(/\b(?:test|it)\(\s*(["'`])((?:(?!\1).){3,300})\1/g)];
  return starts.map((m, i) => {
    const body = src.slice(m.index, starts[i + 1]?.index ?? src.length);
    return {
      title: m[2] as string,
      assertions: body
        .split("\n")
        .filter((l) => /expect\(|getByLabel\(|toBe|toThrow/.test(l))
        .map((l) => l.trim().slice(0, 200)),
      conditional: /\btest\.skip\(|\bit\.skipIf\(|\bdescribe\.skipIf\(/.test(body),
    };
  });
}

/**
 * Only tests that exist in the assembled package can prove a criterion (ADR-0043): rules whose file or test title is
 * not in `outDir` are dropped (e.g. an AI-only spec of a component in an app without the assistant, or a base test a
 * component replaced). Hand-written rules get the shipped test's title and assertions as proof, checked with the
 * refusal and actor veto, or the full proof when the test skips itself on a condition.
 */
export function shippedRules(outDir: string, rules: readonly CoverageRule[]): CoverageRule[] {
  const cache = new Map<string, ReturnType<typeof blocksOf> | null>();
  const read = (file: string) => {
    if (!cache.has(file)) {
      const p = join(outDir, file);
      cache.set(file, existsSync(p) ? blocksOf(readFileSync(p, "utf8")) : null);
    }
    return cache.get(file) ?? null;
  };
  return rules.flatMap((r) => {
    const [file = "", title] = r.test.split(" › ");
    const blocks = read(file);
    if (!blocks) return [];
    if (!title) return [r];
    const block = blocks.find((b) => b.title === title);
    if (!block) return [];
    if (r.proof) return [r];
    return [
      {
        ...r,
        proof: { title: block.title, assertions: block.assertions },
        check: block.conditional ? ("full" as const) : ("veto" as const),
      },
    ];
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
    s.tests.length === 0
      ? s
      : { ...s, status: gatePassed ? ("met" as const) : ("covered" as const) },
  );
  writeAcceptance(outDir, next);
  return next;
}
