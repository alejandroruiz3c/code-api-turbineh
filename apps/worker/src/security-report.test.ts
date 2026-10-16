import { alertsOf, type SecurityFix } from "@turbineh/remediation";
import type { VerifyResult } from "@turbineh/verifier";
import { describe, expect, it } from "vitest";
import { advisoryExceptions, securityMarkdown } from "./finalize.js";

const braces = {
  id: "GHSA-grv7-fg5c-xmjg",
  pkg: "braces@3.0.3",
  severity: "HIGH",
  scope: "development" as const,
};

const result = (over: Partial<VerifyResult["findings"]> = {}): VerifyResult => ({
  ok: true,
  scannedAt: "2026-10-16T10:00:00.000Z",
  steps: [
    { name: "static", ok: true, ms: 1, detail: "" },
    { name: "dependencies", ok: true, ms: 1, detail: "", warnings: 1 },
  ],
  findings: {
    secrets: 0,
    licenses: [],
    static: [],
    advisories: [braces],
    staticScanned: true,
    ...over,
  },
});

describe("SECURITY.md is honest about fixes and exceptions (ADR-0065)", () => {
  it("lists a development-only high advisory without a patch as an accepted exception with a review date", async () => {
    const v = result();
    const exceptions = await advisoryExceptions(v, async () => null);
    expect(exceptions).toEqual([
      expect.objectContaining({
        id: "GHSA-grv7-fg5c-xmjg",
        pkg: "braces@3.0.3",
        patched: null,
        reviewBy: "2026-11-15",
      }),
    ]);
    const md = securityMarkdown(
      v,
      alertsOf(v),
      { fixed: [], notFixed: [], refused: [] },
      exceptions,
    );
    expect(md).toMatch(
      /\| Known vulnerabilities \(direct \+ transitive\) \| security \| OSV database \| pass with warnings \(1\) \|/,
    );
    expect(md).toContain("**GHSA-grv7-fg5c-xmjg** · high · `braces@3.0.3` — development-only");
    expect(md).toContain("patched version: none published yet. Review by 2026-11-15.");
    expect(md).toContain("- Nothing was fixed automatically.");
  });

  it("says when the patched-version lookup failed instead of guessing", async () => {
    const [e] = await advisoryExceptions(result(), async () => {
      throw new Error("offline");
    });
    expect(e?.patched).toBeUndefined();
    const md = securityMarkdown(result(), [], { fixed: [], notFixed: [], refused: [] }, [e!]);
    expect(md).toContain("patched version: unknown (OSV lookup failed)");
  });

  it("a finding is never both fixed and remaining; attempted fixes that did not work are said as such", () => {
    const warning = {
      rule: "turbineh.sensitive-logging",
      severity: "WARNING" as const,
      path: "src/lib/log.ts",
      line: 4,
      message: "Logging values named like passwords",
      explain: "secrets in logs",
    };
    const v = result({ static: [warning], advisories: [] });
    const fixed: SecurityFix[] = [
      {
        kind: "code",
        rule: "turbineh.open-redirect",
        where: "src/app/go/route.ts:3",
        unit: "src/app/go/route.ts",
        severity: "ERROR",
        round: 1,
        change: "src/app/go/route.ts",
        commit: "abcdef0123456789",
      },
    ];
    const md = securityMarkdown(
      v,
      alertsOf(v),
      {
        fixed,
        notFixed: [
          {
            kind: "code",
            rule: warning.rule,
            where: "src/lib/log.ts:4",
            unit: "src/lib/log.ts",
            severity: "WARNING",
          },
        ],
        refused: [
          {
            phase: "security-fix",
            file: "src/lib/log.ts",
            reason: "a check suppression was added (nosemgrep)",
          },
        ],
      },
      [],
    );
    const fixedSection =
      md.split("## Fixed automatically before delivery")[1]?.split("## ")[0] ?? "";
    expect(fixedSection).toContain(
      "`turbineh.open-redirect` at `src/app/go/route.ts:3` — fixed in round 1 (commit `abcdef012345`)",
    );
    expect(fixedSection).not.toContain("src/lib/log.ts");
    expect(md).toContain("## Attempted, not fixed");
    expect(md).toContain(
      "`src/lib/log.ts` (security-fix): a check suppression was added (nosemgrep)",
    );
    expect(md).toContain("(src/lib/log.ts:4)");
  });
});
