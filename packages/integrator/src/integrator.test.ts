import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerifyResult } from "@turbineh/verifier";
import { describe, expect, it } from "vitest";
import { commit, correctableFiles, failureLog, qualityFailed } from "./corrector.js";
import { isFillable } from "./gaps.js";
import { copyCuratedGlue, glueFile } from "./integrate.js";
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

  it("corrects a business-rules module when its tests fail, never the fixture test written by code", () => {
    const dir = mkdtempSync(join(tmpdir(), "corrector-"));
    const write = (rel: string, body: string) => {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), body);
    };
    write("src/entities/loans/rules.ts", "// turbineh:generated-backup trigger=T3\nexport {};\n");
    write("tests/unit/rules/loans.test.ts", "// turbineh:generated-backup trigger=T3\n");
    write("tests/unit/rules/loans.fixtures.test.ts", "// turbineh:generated\n");
    write("src/entities/loans/related.ts", "// turbineh:generated\nexport {};\n");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "-A"], { cwd: dir });
    const log = failureLog(
      result([
        step(
          "unit",
          false,
          "FAIL tests/unit/rules/loans.fixtures.test.ts > accepts\nsrc/entities/loans/related.ts(3,1): error",
        ),
      ]),
    );
    // The related-record loaders (workspace scoping, written by code) are never handed to a model either.
    expect(correctableFiles(dir, log)).toEqual(["src/entities/loans/rules.ts"]);
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

describe("curated glue", () => {
  it("copies glue.ts shipped with the component (no model call) and leaves others to the model", () => {
    const catalogDir = mkdtempSync(join(tmpdir(), "comp-"));
    writeFileSync(join(catalogDir, "glue.ts"), "export const ok = true;\n");
    const app = mkdtempSync(join(tmpdir(), "app-"));
    const comp = {
      id: "email.plain-text.html-to-text",
      capability: "email.plain-text",
      label: "Plain text",
      pkg: { name: "html-to-text", version: "10.0.1" },
      does: "",
      doesNot: "",
      dir: catalogDir,
    };
    const file = copyCuratedGlue(app, comp);
    expect(file).toBe(glueFile("email.plain-text"));
    const written = readFileSync(join(app, file ?? ""), "utf8");
    expect(written).toContain("source=catalog");
    expect(written).toContain("export const ok = true;");
    expect(copyCuratedGlue(app, { ...comp, dir: mkdtempSync(join(tmpdir(), "none-")) })).toBeNull();
  });
});

describe("correction commits", () => {
  it("puts migrations generated by verification in their own commit", () => {
    const dir = mkdtempSync(join(tmpdir(), "corr-"));
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    commit(dir, "init");
    mkdirSync(join(dir, "drizzle"));
    writeFileSync(join(dir, "drizzle", "0000_init.sql"), "CREATE TABLE t (id int);\n");
    writeFileSync(join(dir, "a.ts"), "export const a = 2;\n");
    commit(dir, "fix: directed correction 1 (1 file(s))");
    expect(git("show", "--name-only", "--format=", "HEAD").trim()).toBe("a.ts");
    expect(git("show", "--name-only", "--format=%s", "HEAD~1").trim()).toBe(
      "chore(db): migrations generated from the schema\n\ndrizzle/0000_init.sql",
    );
  });
});
