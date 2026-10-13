import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { left, locate, readGuide, verifyPackage, type PackageGuideFile } from "./package-guide.js";

const guide: PackageGuideFile = {
  schema: "turbineh.package/v1",
  buildId: "0725e867-47cb-48f8-90a2-2dcc2f0fe37d",
  app: { name: "Northwind Coffee Roasters" },
  status: "verified",
  left: [],
  criteria: [
    {
      text: "Shoppers search by name or description",
      status: "met",
      test: { file: "tests/e2e/shop.spec.ts", title: "search" },
    },
  ],
  gate: { ok: true, verifiedAt: "2026-10-12T00:00:00Z", steps: [], findings: [] },
  env: { required: [{ name: "DATABASE_URL" }, { name: "TURBINEH_TEST_UNSET_VAR" }] },
  rerun: [{ change: "Copy", run: "pnpm lint && pnpm typecheck", note: "" }],
};

function pkg(g: PackageGuideFile = guide): string {
  const dir = mkdtempSync(join(tmpdir(), "pkg-"));
  writeFileSync(join(dir, "turbineh.json"), JSON.stringify(g));
  writeFileSync(join(dir, ".env.local"), "DATABASE_URL=postgres://x\n");
  return dir;
}

describe("delivered package (turbineh.json)", () => {
  it("prints what is left: nothing but the missing setting", () => {
    const dir = pkg();
    expect(readGuide(dir)?.app.name).toBe("Northwind Coffee Roasters");
    const r = left(dir, guide);
    expect((r.data as { left: { kind: string; what: string }[] }).left).toEqual([
      expect.objectContaining({ kind: "setting", what: "TURBINEH_TEST_UNSET_VAR is not set" }),
    ]);
  });

  it("verify points each failure to file:line and the fix", () => {
    const dir = pkg();
    const r = verifyPackage(dir, guide, (_cmd, args) =>
      args[1] === "typecheck"
        ? {
            ok: false,
            detail:
              "src/app/shop/page.tsx(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
          }
        : { ok: true, detail: "" },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatchObject({
      code: "check_failed_typecheck",
      message: "typecheck failed at src/app/shop/page.tsx:12.",
    });
    expect(r.error?.action).toContain("pnpm typecheck");
  });

  it("locates ESLint and Vitest failures", () => {
    expect(locate("/work/app/src/lib/shop.ts\n  3:10  error  'x' is unused")).toBe(
      "src/lib/shop.ts:3",
    );
    expect(locate(" ❯ tests/unit/shop.test.ts:41:9")).toBe("tests/unit/shop.test.ts:41");
  });
});
