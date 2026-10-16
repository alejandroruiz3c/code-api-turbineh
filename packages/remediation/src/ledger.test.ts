import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StaticFinding, VerifyResult } from "@turbineh/verifier";
import { describe, expect, it } from "vitest";
import {
  commitRecord,
  findingRefs,
  headCommit,
  notFixedFinally,
  reconcileFixes,
  settleRound,
  attempted,
} from "./ledger.js";
import type { RemediationChange } from "./remediate.js";

const finding = (over: Partial<StaticFinding> = {}): StaticFinding => ({
  rule: "turbineh.unsanitized-html",
  severity: "ERROR",
  path: "src/app/[collection]/[slug]/page.tsx",
  line: 60,
  message: "raw HTML",
  explain: "XSS",
  ...over,
});

const result = (
  stat: StaticFinding[],
  advisories: VerifyResult["findings"]["advisories"] = [],
  staticScanned = true,
): VerifyResult => ({
  ok: stat.length === 0,
  steps: [],
  scannedAt: "2026-10-16T10:00:00Z",
  findings: { secrets: 0, advisories, licenses: [], static: stat, staticScanned },
});

const codeChange = (f: StaticFinding): RemediationChange => ({
  kind: "code",
  target: `${f.path}:${f.line}`,
  reason: f.rule,
  detail: f.message,
});

describe("security ledger: fixed means gone from a new scan (ADR-0065, N-02)", () => {
  it("the audit case: the same XSS 'fixed' in two rounds and still present is never counted, never both", () => {
    const xss = finding();
    const before = result([xss]);
    // Round 1 and round 2 both claim to fix it; every re-scan still finds it.
    const r1 = settleRound(1, before, result([xss]), [codeChange(xss)], "c1");
    const r2 = settleRound(2, result([xss]), result([xss]), [codeChange(xss)], "c2");
    expect(r1.fixed).toEqual([]);
    expect(r2.fixed).toEqual([]);
    expect(r1.notFixed.map((f) => f.where)).toEqual(["src/app/[collection]/[slug]/page.tsx:60"]);
    const fixed = reconcileFixes([...r1.fixed, ...r2.fixed], before, result([xss]));
    expect(fixed).toHaveLength(0);
    const tried = [
      ...attempted(before, [codeChange(xss)]),
      ...attempted(before, [codeChange(xss)]),
    ];
    expect(notFixedFinally(tried, fixed)).toHaveLength(1); // deduplicated
  });

  it("counts a finding fixed once, even when two rounds report it", () => {
    const xss = finding();
    const r1 = settleRound(1, result([xss]), result([]), [codeChange(xss)], "c1");
    expect(r1.fixed).toHaveLength(1);
    expect(r1.fixed[0]).toMatchObject({ rule: xss.rule, round: 1, commit: "c1" });
    const fixed = reconcileFixes([...r1.fixed, ...r1.fixed], result([xss]), result([]));
    expect(fixed).toHaveLength(1);
  });

  it("is not fooled by line numbers that move: a rule and file that keep their findings fixed nothing", () => {
    const a = finding({ line: 10 });
    const b = finding({ line: 20 });
    // The fixer edited the file; the same two findings are now at other lines.
    const r = settleRound(
      1,
      result([a, b]),
      result([finding({ line: 12 }), finding({ line: 22 })]),
      [codeChange(a), codeChange(b)],
      "c1",
    );
    expect(r.fixed).toEqual([]);
    // One of two really fixed: exactly one counted.
    const half = settleRound(
      1,
      result([a, b]),
      result([finding({ line: 12 })]),
      [codeChange(a), codeChange(b)],
      "c1",
    );
    expect(half.fixed).toHaveLength(1);
  });

  it("drops a fix that a later repair undid: the final scan decides", () => {
    const xss = finding();
    const r1 = settleRound(1, result([xss]), result([]), [codeChange(xss)], "c1");
    expect(reconcileFixes(r1.fixed, result([xss]), result([xss]))).toEqual([]);
  });

  it("never counts code as fixed from a scan that did not run", () => {
    const xss = finding();
    const r = settleRound(1, result([xss]), result([], [], false), [codeChange(xss)], "c1");
    expect(r.fixed).toEqual([]);
    expect(
      reconcileFixes(
        [{ ...findingRefs(result([xss]))[0]!, round: 1, change: "x", commit: null }],
        result([xss]),
        result([], [], false),
      ),
    ).toEqual([]);
  });

  it("only counts what was attempted, and dependencies by advisory and package", () => {
    const other = finding({ rule: "turbineh.open-redirect", path: "src/app/go/route.ts", line: 3 });
    const adv = {
      id: "GHSA-1",
      pkg: "next@16.0.0",
      severity: "HIGH",
      scope: "production" as const,
    };
    const dep: RemediationChange = {
      kind: "dependency",
      target: "next → 16.0.1",
      reason: "GHSA-1",
      detail: "HIGH advisory in next@16.0.0 (production)",
    };
    const r = settleRound(1, result([other], [adv]), result([], []), [dep], "c1");
    // The open redirect vanished without being attempted (not counted); the advisory was pinned and is gone.
    expect(r.fixed.map((f) => [f.rule, f.where, f.change])).toEqual([
      ["GHSA-1", "next@16.0.0", "next → 16.0.1"],
    ]);
  });

  it("deduplicates findings by rule, file and line", () => {
    expect(findingRefs(result([finding(), finding()]))).toHaveLength(1);
  });
});

describe("correction records", () => {
  it("records the commit, its files and its diff, bounded", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-"));
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    const since = headCommit(dir);
    expect(commitRecord(dir, since)).toBeNull();
    writeFileSync(join(dir, "a.ts"), Array.from({ length: 300 }, (_, i) => `// ${i}`).join("\n"));
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fix");
    const r = commitRecord(dir, since, 50);
    expect(r?.files).toEqual(["a.ts"]);
    expect(r?.commit).toBe(headCommit(dir));
    expect(r?.truncated).toBe(true);
    expect(r?.diff.split("\n")).toHaveLength(50);
    expect(r?.diff).toContain("-export const a = 1;");
  });
});
