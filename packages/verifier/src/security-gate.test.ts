import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCheckConfig, revertForbiddenChanges, suppressionAdded } from "./assertions.js";
import {
  advisoryBlocks,
  checkStatus,
  gateFindings,
  gateSeverity,
  isExposedRoute,
  type StaticFinding,
  type VerifyResult,
} from "./verify.js";

const xss: StaticFinding = {
  rule: "turbineh.unsanitized-html",
  severity: "WARNING",
  path: "src/app/[collection]/[slug]/page.tsx",
  line: 60,
  message: "dangerouslySetInnerHTML renders raw HTML; sanitize it first.",
  explain: "XSS",
};

describe("XSS and open redirects in exposed routes always block (ADR-0065)", () => {
  it("raises them to ERROR in routes, pages, layouts and components", () => {
    expect(gateSeverity(xss)).toMatchObject({ severity: "ERROR", escalated: "exposed-route" });
    expect(
      gateSeverity({ ...xss, rule: "turbineh.open-redirect", path: "src/app/login/actions.ts" })
        .severity,
    ).toBe("ERROR");
    expect(gateSeverity({ ...xss, path: "src/components/rich-text.tsx" }).severity).toBe("ERROR");
  });

  it("leaves server-only helpers, scripts and other warnings as they are", () => {
    expect(gateSeverity({ ...xss, path: "scripts/report.tsx" }).severity).toBe("WARNING");
    expect(gateSeverity({ ...xss, rule: "turbineh.sensitive-logging" }).severity).toBe("WARNING");
    expect(isExposedRoute("src/app/page.test.tsx")).toBe(false);
    expect(isExposedRoute("src/lib/email.ts")).toBe(false);
  });

  it("reports an escalated finding as blocking, with why", () => {
    const v = {
      ok: false,
      steps: [],
      scannedAt: "",
      findings: { secrets: 0, advisories: [], licenses: [], static: [gateSeverity(xss)] },
    } as VerifyResult;
    const [f] = gateFindings(v);
    expect(f).toMatchObject({ blocking: true, where: "src/app/[collection]/[slug]/page.tsx:60" });
    expect(f?.message).toMatch(/reachable by visitors/);
  });
});

describe("pass with warnings (ADR-0065)", () => {
  it("is a state of its own: never a plain pass when non-blocking findings remain", () => {
    expect(checkStatus({ ok: true })).toBe("pass");
    expect(checkStatus({ ok: true, warnings: 1 })).toBe("warn");
    expect(checkStatus({ ok: false, warnings: 3 })).toBe("fail");
  });

  it("a development-only high advisory does not block, a production one does", () => {
    const braces = { id: "GHSA-grv7-fg5c-xmjg", pkg: "braces@3.0.3", severity: "HIGH" };
    expect(advisoryBlocks({ ...braces, scope: "development" })).toBe(false);
    expect(advisoryBlocks({ ...braces, scope: "production" })).toBe(true);
    expect(advisoryBlocks({ ...braces, severity: "MODERATE", scope: "production" })).toBe(false);
  });
});

describe("a repair may never silence a check (ADR-0065)", () => {
  it("detects added suppressions, not existing ones", () => {
    const before = "export const a = 1;\n// nosemgrep: turbineh.unsanitized-html -- JSON-LD\n";
    expect(suppressionAdded(before, before)).toBeNull();
    expect(suppressionAdded(before, `${before}// eslint-disable-next-line\n`)).toMatch(
      /eslint-disable-next-line/,
    );
    expect(suppressionAdded("x", "// @ts-ignore\nx")).toMatch(/@ts-ignore/);
    expect(suppressionAdded(before, `// nosemgrep\n${before}`)).toMatch(/nosemgrep/);
    expect(suppressionAdded(null, "// gitleaks:allow")).toMatch(/gitleaks:allow/);
  });

  it("knows the configuration files of the checks", () => {
    for (const f of [
      "eslint.config.mjs",
      ".semgrepignore",
      ".gitleaksignore",
      "tsconfig.json",
      "vitest.config.ts",
      "playwright.config.ts",
    ])
      expect(isCheckConfig(f)).toBe(true);
    expect(isCheckConfig("src/app/page.tsx")).toBe(false);
  });

  it("restores suppressed files and edited check configuration from HEAD, and removes new ignore files", () => {
    const dir = mkdtempSync(join(tmpdir(), "forbidden-"));
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    const page = "export default function P() {\n  return null;\n}\n";
    const lint = "export default [];\n";
    writeFileSync(join(dir, "page.tsx"), page);
    writeFileSync(join(dir, "eslint.config.mjs"), lint);
    writeFileSync(join(dir, "ok.ts"), "export const a = 1;\n");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    writeFileSync(join(dir, "page.tsx"), `// nosemgrep\n${page}`);
    writeFileSync(join(dir, "eslint.config.mjs"), "export default [{ rules: {} }];\n");
    writeFileSync(join(dir, ".semgrepignore"), "src/\n");
    writeFileSync(join(dir, "ok.ts"), "export const a = 2;\n");
    const refused = revertForbiddenChanges(dir, [
      "page.tsx",
      "eslint.config.mjs",
      ".semgrepignore",
      "ok.ts",
    ]);
    expect(refused.map((r) => r.file).sort()).toEqual([
      ".semgrepignore",
      "eslint.config.mjs",
      "page.tsx",
    ]);
    expect(readFileSync(join(dir, "page.tsx"), "utf8")).toBe(page);
    expect(readFileSync(join(dir, "eslint.config.mjs"), "utf8")).toBe(lint);
    expect(existsSync(join(dir, ".semgrepignore"))).toBe(false);
    // A code fix without a suppression goes through.
    expect(readFileSync(join(dir, "ok.ts"), "utf8")).toBe("export const a = 2;\n");
  });
});
