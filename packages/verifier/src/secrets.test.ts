import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { leakingFiles } from "./secrets.js";

const hasGitleaks = !spawnSync("gitleaks", ["version"]).error;

describe("pre-commit secret scan", () => {
  it.skipIf(!hasGitleaks)("flags secret-looking literals and lets obvious fakes through", () => {
    const dir = mkdtempSync(join(tmpdir(), "leaks-"));
    // Built at runtime so this test file itself never contains a key-like literal.
    const fake = ["AKIA", "Q3EGRKZ7", "NLP4XWVT"].join("");
    writeFileSync(join(dir, "bad.ts"), `export const aws = "${fake}";\n`);
    writeFileSync(join(dir, "good.ts"), 'export const key = "key-1";\n');
    expect(leakingFiles(dir, ["bad.ts", "good.ts", "missing.ts"])).toEqual(["bad.ts"]);
  });
});
