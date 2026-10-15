import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertionWeakening,
  isFixedOracle,
  isTestFile,
  revertWeakenedTests,
} from "./assertions.js";

const SPEC = `import { expect, it } from "vitest";
it("a member cannot approve", () => {
  expect(can("member", "approve")).toBe(false);
  expect(can("member", "export")).toBe(false);
});
it("owners manage members", () => {
  expect(can("owner", "manage_members")).toBe(true);
});
`;

describe("a repair may never weaken a test (ADR-0054)", () => {
  it("refuses deleted files, removed assertions, removed tests and skipped tests", () => {
    expect(assertionWeakening(SPEC, null)).toMatch(/deleted/);
    expect(
      assertionWeakening(
        SPEC,
        SPEC.replace('  expect(can("member", "export")).toBe(false);\n', ""),
      ),
    ).toMatch(/assertions removed \(3 → 2\)/);
    expect(
      assertionWeakening(SPEC, SPEC.replace('it("owners manage members"', 'it("owners do things"')),
    ).toMatch(/removed or renamed: "owners manage members"/);
    expect(assertionWeakening(SPEC, SPEC.replace('it("owners', 'it.skip("owners'))).toMatch(
      /skipped/,
    );
  });

  it("refuses any changed assertion of a fixed oracle, but lets code-only fixes through", () => {
    const flipped = SPEC.replace('"approve")).toBe(false)', '"approve")).toBe(true)');
    expect(assertionWeakening(SPEC, flipped, true)).toMatch(/fixed oracle changed/);
    expect(assertionWeakening(SPEC, `${SPEC}\n// a comment\n`, true)).toBeNull();
    expect(assertionWeakening(SPEC, SPEC.replace("vitest", "vitest" + ""), true)).toBeNull();
  });

  it("knows test files and the fixed oracles written by code", () => {
    expect(isTestFile("tests/unit/permissions.test.ts")).toBe(true);
    expect(isTestFile("tests/e2e/notes.spec.ts")).toBe(true);
    expect(isTestFile("src/entities/notes/actions.ts")).toBe(false);
    expect(isFixedOracle("tests/unit/permissions.test.ts")).toBe(true);
    expect(isFixedOracle("tests/unit/rules/notes.fixtures.test.ts")).toBe(true);
    expect(isFixedOracle("tests/unit/backup/slug.test.ts")).toBe(false);
  });

  it("restores weakened test files from HEAD and leaves code changes alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "assertions-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
          cwd: dir,
          stdio: "pipe",
        });
      git("init", "-q");
      mkdirSync(join(dir, "tests/unit"), { recursive: true });
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "tests/unit/permissions.test.ts"), SPEC);
      writeFileSync(join(dir, "src/permissions.ts"), "export const x = 1;\n");
      git("add", "-A");
      git("commit", "-q", "-m", "init");
      writeFileSync(
        join(dir, "tests/unit/permissions.test.ts"),
        SPEC.replace('"approve")).toBe(false)', '"approve")).toBe(true)'),
      );
      writeFileSync(join(dir, "src/permissions.ts"), "export const x = 2;\n");
      const weakened = revertWeakenedTests(dir, [
        "tests/unit/permissions.test.ts",
        "src/permissions.ts",
      ]);
      expect(weakened.map((w) => w.file)).toEqual(["tests/unit/permissions.test.ts"]);
      expect(readFileSync(join(dir, "tests/unit/permissions.test.ts"), "utf8")).toBe(SPEC);
      expect(readFileSync(join(dir, "src/permissions.ts"), "utf8")).toBe("export const x = 2;\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
