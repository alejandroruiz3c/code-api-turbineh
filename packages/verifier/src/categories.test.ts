import { describe, expect, it } from "vitest";
import {
  failureLocation,
  findingCategory,
  gateFindings,
  type StaticFinding,
  type VerifyResult,
} from "./verify.js";

const secret = (path: string): StaticFinding => ({
  rule: "turbineh.hardcoded-secret",
  severity: "ERROR",
  path,
  line: 7,
  message: "A secret-looking value is hardcoded",
  explain: "",
});

/** A flagged source line, built at runtime so no secret-shaped literal is committed. */
const line = (value: string) => ["const", "apiKey", "=", JSON.stringify(value)].join(" ");

describe("finding categories (security vs policy)", () => {
  it("labels a secret-shaped test placeholder as policy, a real-looking one in app code as security", () => {
    // Frontiers shop · alone: a whsec_… placeholder in playwright.config.ts.
    expect(findingCategory(secret("playwright.config.ts"), 'STRIPE_WEBHOOK_SECRET: "x"')).toBe(
      "policy",
    );
    expect(findingCategory(secret("tests/e2e/support/stub.ts"))).toBe("policy");
    expect(findingCategory(secret("src/lib/pay.ts"), line("e2e_local_stub"))).toBe("policy");
    expect(findingCategory(secret("src/lib/pay.ts"), line("Zx81kQp0".repeat(3)))).toBe("security");
    expect(
      findingCategory({ ...secret("src/app/x.ts"), rule: "turbineh.server-action-without-authz" }),
    ).toBe("security");
  });

  it("reports licences as policy (still blocking) and failing checks as quality with their location", () => {
    const v: VerifyResult = {
      ok: false,
      steps: [
        {
          name: "typecheck",
          ok: false,
          ms: 1,
          detail: "src/app/shop/page.tsx(12,7): error TS2322: Type 'string' is not assignable",
        },
        { name: "licenses", ok: false, ms: 0, detail: "" },
      ],
      findings: {
        secrets: 0,
        advisories: [],
        licenses: ["@img/sharp-libvips-linux-x64@1.2.4 LGPL-3.0-or-later"],
        static: [{ ...secret("playwright.config.ts"), category: "policy" }],
      },
      scannedAt: "",
    };
    expect(gateFindings(v)).toEqual([
      expect.objectContaining({
        category: "policy",
        rule: "turbineh.hardcoded-secret",
        where: "playwright.config.ts:7",
        blocking: true,
      }),
      expect.objectContaining({
        category: "policy",
        rule: "licence-policy",
        where: "@img/sharp-libvips-linux-x64@1.2.4",
        blocking: true,
      }),
      expect.objectContaining({
        category: "quality",
        rule: "typecheck",
        where: "src/app/shop/page.tsx:12",
      }),
    ]);
  });

  it("finds the failing file in tool output", () => {
    expect(failureLocation("  at tests/e2e/shop.spec.ts:41:9")).toBe("tests/e2e/shop.spec.ts:41");
    expect(failureLocation("/work/src/lib/shop.ts\n  3:10  error  'x' is unused")).toBe(
      "src/lib/shop.ts:3",
    );
    expect(failureLocation("nothing here")).toBeNull();
  });
});
