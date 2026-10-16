import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { proofVerdict, type ProofCandidate } from "@turbineh/shared";
import { parse } from "yaml";

/**
 * Acceptance criteria → tests (ADR-0033), generic for every recipe and component. Each recipe or native component
 * may ship `acceptance.yaml`: a list of `{ test, covers }` where `covers` is a list of case-insensitive regular
 * expressions that must all match a criterion's text. Matching is code, never a model. `covers` only pre-selects:
 * every rule — hand-written or generated — also carries its proof (the shipped test's title and key assertions, read
 * from the test file) and matches only when `proofVerdict` accepts it (ADR-0039; hand-written rules since ADR-0043).
 * A rule whose test is not in the package proves nothing. A criterion is:
 *   - "met"     when a test proves it and the verification gate (unit + E2E) passed;
 *   - "covered" when a test proves it but the gate has not run (or failed);
 *   - "open"    when nothing in the package proves it: the coding agent knows exactly what is left.
 */
export interface CoverageRule {
  /** "tests/e2e/file.spec.ts › test title" (or a unit test file). */
  test: string;
  covers: string[];
  /** Where the rule comes from (recipe or component id). */
  from?: string;
  /**
   * The test's title and key assertions as shipped. Required to match: beyond `covers`, they must exercise the
   * criterion's subject, action, actor and any negation (`proofVerdict`, precision first). See `attachProofs`.
   */
  proof?: ProofCandidate;
}

export interface CriterionStatus {
  criterion: string;
  status: "met" | "covered" | "open";
  tests: string[];
  /** Canonical criteria this criterion is linked to (ADR-0063): met exactly when their tests pass. */
  canonical?: string[];
  /** The request's own wording a canonical criterion replaced (ADR-0063). */
  asked?: string[];
}

/** Canonical links (ADR-0063) take precedence over rule matching: declared, not guessed. */
export function withCanonicalLinks(
  statuses: readonly CriterionStatus[],
  links: ReadonlyMap<string, { canonical: string[]; tests: string[] }>,
  asked: Record<string, string[]> = {},
  gatePassed: boolean | null = null,
): CriterionStatus[] {
  return statuses.map((s) => {
    const l = links.get(s.criterion);
    const a = asked[s.criterion];
    const base = a?.length ? { ...s, asked: a } : s;
    if (!l || l.tests.length === 0) return base;
    return {
      ...base,
      tests: l.tests,
      canonical: l.canonical,
      status: gatePassed ? "met" : "covered",
    };
  });
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

/**
 * Test titles with their key steps and assertions (form fields filled, expect lines), in file order. Playwright
 * (`test(`, `setup(`) and Vitest (`it(`, `test(`), any quote style.
 */
export function testBlocks(src: string): { title: string; assertions: string[] }[] {
  const starts = [
    ...src.matchAll(
      /\b(?:test|it|setup)(?:\.only|\.skip)?\(\s*(["'`])((?:(?!\1)[^\n\\]){5,200})\1/g,
    ),
  ];
  return starts.map((m, i) => {
    const body = src.slice(m.index, starts[i + 1]?.index ?? src.length);
    const lines = body.split("\n");
    const assertions: string[] = [];
    lines.forEach((l, j) => {
      if (!/expect\(|getByLabel\(/.test(l)) return;
      // The whole statement, when a formatter split it: its message ("…what this checks") is part of the proof.
      let stmt = l.trim();
      for (let k = j + 1; k < lines.length && k <= j + 8 && !/[;{]\s*$/.test(stmt); k++)
        stmt += ` ${(lines[k] ?? "").trim()}`;
      assertions.push(stmt.replace(/\s+/g, " ").slice(0, 300));
    });
    return { title: m[2] as string, assertions };
  });
}

/** "tests/e2e/a.spec.ts › title" → the file and the title. */
export const splitTestRef = (ref: string): { file: string; title: string } => {
  const at = ref.indexOf(" › ");
  return at < 0 ? { file: ref, title: "" } : { file: ref.slice(0, at), title: ref.slice(at + 3) };
};

/**
 * Attaches to each rule the proof of the test it names, read from the test's source (`source(file)` returns it, or
 * null when the file is not there). A rule whose file or title does not exist is dropped: it cannot prove anything.
 */
export function attachProofs(
  rules: readonly CoverageRule[],
  source: (file: string) => string | null,
): CoverageRule[] {
  const cache = new Map<string, ProofCandidate[] | null>();
  return rules.flatMap((r) => {
    const { file, title } = splitTestRef(r.test);
    if (!cache.has(file)) {
      const src = source(file);
      cache.set(file, src === null ? null : testBlocks(src));
    }
    const block = cache.get(file)?.find((b) => b.title === title);
    return block ? [{ ...r, proof: block }] : [];
  });
}

/** Reads a test file from the first folder that has it (the assembled package, or the catalog sources). */
export const sourceIn =
  (...dirs: string[]) =>
  (file: string): string | null => {
    for (const d of dirs) {
      const p = join(d, file);
      if (existsSync(p)) return readFileSync(p, "utf8");
    }
    return null;
  };

/** Covers pre-selects; the proof decides. No proof, no match (precision first). */
export function ruleProves(criterion: string, rule: CoverageRule): boolean {
  return (
    rule.covers.length > 0 &&
    rule.covers.every((re) => {
      try {
        return new RegExp(re, "i").test(criterion);
      } catch {
        return false;
      }
    }) &&
    rule.proof !== undefined &&
    proofVerdict(criterion, rule.proof).proven
  );
}

export function acceptanceStatus(
  criteria: readonly string[],
  rules: readonly CoverageRule[],
  gatePassed: boolean | null = null,
): CriterionStatus[] {
  return criteria.map((criterion) => {
    const tests = [...new Set(rules.filter((r) => ruleProves(criterion, r)).map((r) => r.test))];
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
        `| ${s.criterion.replace(/\|/g, "/")}${s.asked?.length ? `<br><sub>asked as: ${s.asked.map((a) => a.replace(/\|/g, "/")).join(" · ")}</sub>` : ""} | ${icon[s.status]} | ${s.tests.map((t) => `\`${t}\``).join("<br>") || "—"} |`,
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
