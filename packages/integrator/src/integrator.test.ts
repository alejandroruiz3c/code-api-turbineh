import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerifyResult } from "@turbineh/verifier";
import { describe, expect, it } from "vitest";
import { correctableFiles, failureLog, qualityFailed } from "./corrector.js";
import { isFillable } from "./gaps.js";
import { glueFile } from "./integrate.js";
import { withHeader } from "./model.js";

const step = (name: string, ok: boolean, detail = "") => ({ name, ok, ms: 1, detail });
const result = (steps: ReturnType<typeof step>[]) => ({ steps }) as unknown as VerifyResult;

describe("corrector scope", () => {
  it("only reacts to quality gates, never to security scans", () => {
    expect(qualityFailed(result([step("lint", false)]))).toBe(true);
    expect(qualityFailed(result([step("static", false), step("lint", true)]))).toBe(false);
  });

  it("edits only generated files named in the failing log, never contract tests or recipe code", () => {
    const dir = mkdtempSync(join(tmpdir(), "corrector-"));
    const write = (rel: string, body: string) => {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), body);
    };
    write("src/integrations/a.ts", "// turbineh:generated glue\nexport const a = 1;\n");
    write("src/server/authz.ts", "export const recipe = 1;\n");
    write("tests/unit/components/x.test.ts", "// turbineh:generated\n");
    write("src/backup/b.ts", "// turbineh:generated-backup trigger=T1\nexport const b = 1;\n");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "-A"], { cwd: dir });
    const log = failureLog(
      result([
        step(
          "typecheck",
          false,
          "src/integrations/a.ts(1,1) src/server/authz.ts(1,1) tests/unit/components/x.test.ts",
        ),
      ]),
    );
    expect(correctableFiles(dir, log)).toEqual(["src/integrations/a.ts"]);
  });
});

describe("policies", () => {
  it("never lets the Backup Coder write auth, security, payments, email or UI", () => {
    expect(isFillable("ops.idempotency")).toBe(true);
    expect(isFillable("data.money")).toBe(true);
    for (const c of [
      "auth.oauth",
      "authz.roles",
      "security.headers",
      "payments.checkout",
      "email.smtp",
      "ui.i18n",
    ]) {
      expect(isFillable(c)).toBe(false);
    }
  });

  it("writes UI glue as .tsx and keeps exactly one header", () => {
    expect(glueFile("ui.notifications")).toBe("src/integrations/ui-notifications.tsx");
    expect(glueFile("data.money")).toBe("src/integrations/data-money.ts");
    expect(
      withHeader("// turbineh:generated glue", "// turbineh:generated old\nexport {};\n"),
    ).toBe("// turbineh:generated glue\nexport {};\n");
  });
});
