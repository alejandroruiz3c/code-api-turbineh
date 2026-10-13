import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requiredEnv, SYNTHETIC_ENV } from "./sandbox.js";
import { onlyRequiredUnset } from "./verify.js";

const STOREFRONT_ENV = join(__dirname, "../../../catalog/recipes/storefront/template/src/env.ts");

describe("build and unit tests with only the required env (ADR-0035)", () => {
  it("reads the required variables from src/env.ts", () => {
    expect(requiredEnv(readFileSync(STOREFRONT_ENV, "utf8"))).toEqual([
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
    ]);
  });

  it("unsets everything the gate provides that the app does not require, allow-lists included", () => {
    const dir = mkdtempSync(join(tmpdir(), "req-env-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "src/env.ts"),
      '  DATABASE_URL: z.string().min(1),\n  BETTER_AUTH_SECRET: z.string().min(32),\n  ADMIN_EMAILS: z.string().default(""),\n',
    );
    const unset = onlyRequiredUnset(dir, {
      ...SYNTHETIC_ENV,
      DATABASE_URL: "postgres://x",
      ADMIN_EMAILS: "a@example.com",
      STRIPE_SECRET_KEY: "placeholder",
    }).split(" ");
    expect(unset).toEqual(
      expect.arrayContaining(["ADMIN_EMAILS", "STRIPE_SECRET_KEY", "BETTER_AUTH_URL", "BASE_HASH"]),
    );
    expect(unset).not.toContain("DATABASE_URL");
    expect(unset).not.toContain("BETTER_AUTH_SECRET");
  });

  it("gives the gate no allow-list and an ambient app URL that E2E must ignore", () => {
    expect(Object.keys(SYNTHETIC_ENV)).not.toContain("ADMIN_EMAILS");
    expect(SYNTHETIC_ENV.BETTER_AUTH_URL).toBe("http://localhost:3000");
  });
});
