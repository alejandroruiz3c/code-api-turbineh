import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Tests are the oracle of a repair, never its target (ADR-0054). Every repair loop (directed corrections, Backup Coder
 * T4 patches, repairs after a security remediation) runs this deterministic check on what it changed: a change that
 * deletes a test file, removes or renames a test, removes an assertion, skips/focuses a test, or (in the fixed oracle
 * files written by code) edits any assertion is reverted before it can be committed. No model decides this.
 */

/** Test files of a generated app (unit, E2E, contract and fixture tests). */
export function isTestFile(path: string): boolean {
  return /(^|\/)tests\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

/**
 * Oracles written by code or by the catalog (fixed expectations): not a single assertion may change, only code may
 * be fixed. Model-written tests (e.g. tests/unit/backup/*, tests/unit/rules/<entity>.test.ts) may have a wrong
 * expectation corrected, but never lose one.
 */
export function isFixedOracle(path: string): boolean {
  return (
    /^tests\/unit\/(permissions|access|authz|data-safety|security|env|spec-constraints)\.test\.ts$/.test(
      path,
    ) ||
    /\.fixtures\.test\.ts$/.test(path) ||
    path.startsWith("tests/unit/components/")
  );
}

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const expects = (s: string) => count(s, /\bexpect\s*(?:\.\s*\w+\s*)?\(/g);
const titles = (s: string) =>
  [...s.matchAll(/\b(?:it|test)(?:\s*\.\s*\w+)?\s*\(\s*(["'`])((?:\\.|(?!\1).)+)\1/g)].map(
    (m) => m[2] ?? "",
  );
const skips = (s: string) =>
  count(
    s,
    /\b(?:it|test|describe)\s*\.\s*(?:skip|todo|only|fixme)\b|\b(?:xit|xtest|xdescribe|fit)\s*\(/g,
  );
const norm = (l: string) => l.replace(/\s+/g, " ").trim();
const assertionLines = (s: string) =>
  s
    .split("\n")
    .filter((l) => /\bexpect\s*(?:\.\s*\w+\s*)?\(|\.rejects\.|\.resolves\.|\.to[A-Z]\w*\(/.test(l))
    .map(norm);

/**
 * Why `after` weakens the test file `before` (null when it does not). `fixed`: the file is a fixed oracle, so any
 * changed or removed assertion line counts.
 */
export function assertionWeakening(
  before: string,
  after: string | null,
  fixed = false,
): string | null {
  if (after === null) return "the test file was deleted";
  if (expects(after) < expects(before))
    return `assertions removed (${expects(before)} → ${expects(after)})`;
  const kept = new Set(titles(after));
  const gone = titles(before).filter((t) => !kept.has(t));
  if (gone.length) return `tests removed or renamed: "${gone[0]}"`;
  if (skips(after) > skips(before)) return "tests skipped, focused or marked todo";
  if (fixed) {
    const now = new Set(assertionLines(after));
    const changed = assertionLines(before).filter((l) => !now.has(l));
    if (changed.length)
      return `an assertion of a fixed oracle changed: ${changed[0]?.slice(0, 160)}`;
  }
  return null;
}

export interface WeakenedTest {
  file: string;
  reason: string;
}

/** The committed version of `file` (HEAD), or null when it is new. */
function committed(dir: string, file: string): string | null {
  const r = spawnSync("git", ["show", `HEAD:${file}`], { cwd: dir, encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}

/**
 * Test files among `files` (changed but not committed yet) whose assertions a repair weakened, compared with HEAD.
 * Each one is restored from HEAD; the caller drops it from what the repair changed.
 */
export function revertWeakenedTests(dir: string, files: readonly string[]): WeakenedTest[] {
  const out: WeakenedTest[] = [];
  for (const file of files) {
    if (!isTestFile(file)) continue;
    const before = committed(dir, file);
    if (before === null) continue;
    const path = join(dir, file);
    const after = existsSync(path) ? readFileSync(path, "utf8") : null;
    const reason = assertionWeakening(before, after, isFixedOracle(file));
    if (!reason) continue;
    execFileSync("git", ["checkout", "HEAD", "--", file], { cwd: dir });
    out.push({ file, reason });
  }
  return out;
}

/**
 * Configuration of the checks themselves (ADR-0065): lint, type-check, test runners and scanner ignore files. A repair
 * that edits one would make a check pass without fixing the code, so it is refused.
 */
export function isCheckConfig(path: string): boolean {
  return /^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.\w+)?|\.eslintignore|\.semgrepignore|\.gitleaks\.toml|\.gitleaksignore|tsconfig(\.\w+)?\.json|vitest\.config\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s)$/.test(
    path,
  );
}

/** Comments that silence a check (Semgrep, ESLint, TypeScript, gitleaks, coverage). */
const SUPPRESSION =
  /\bnosemgrep\b|\beslint-disable(?:-next-line|-line)?\b|@ts-ignore\b|@ts-nocheck\b|@ts-expect-error\b|gitleaks:allow\b/g;

/** Why `after` silences a check that `before` did not (null when it adds no suppression). */
export function suppressionAdded(before: string | null, after: string | null): string | null {
  const was = (before ?? "").match(SUPPRESSION) ?? [];
  const now = (after ?? "").match(SUPPRESSION) ?? [];
  if (now.length <= was.length) return null;
  const left = [...was];
  const added = now.find((s) => {
    const i = left.indexOf(s);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
  return `a check suppression was added (${added ?? now[now.length - 1]})`;
}

/**
 * Every change a repair may not make (ADR-0054, ADR-0065), among `files` changed but not committed yet: weakened tests,
 * edited check configuration and added suppressions (`nosemgrep`, `eslint-disable`, `@ts-ignore`…). Each one is
 * restored from HEAD (or removed when it is new) and returned with the reason, so the report can show it. Tests and
 * rules are the oracle of a repair, never its target.
 */
export function revertForbiddenChanges(dir: string, files: readonly string[]): WeakenedTest[] {
  const out: WeakenedTest[] = revertWeakenedTests(dir, files);
  const done = new Set(out.map((w) => w.file));
  for (const file of files) {
    if (done.has(file)) continue;
    const before = committed(dir, file);
    const path = join(dir, file);
    const after = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (before === after) continue;
    const reason = isCheckConfig(file)
      ? "the configuration of a check was changed"
      : suppressionAdded(before, after);
    if (!reason) continue;
    if (before === null) rmSync(path, { force: true });
    else execFileSync("git", ["checkout", "HEAD", "--", file], { cwd: dir });
    out.push({ file, reason });
  }
  return out;
}
