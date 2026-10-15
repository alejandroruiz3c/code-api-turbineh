import { describe, expect, it } from "vitest";
import { checkBackupCode, needsPersistence } from "./policy.js";

const rules = (code: string, baseline?: string) =>
  checkBackupCode(code, baseline).map((v) => v.rule);

describe("Backup Coder policy (ADR-0055)", () => {
  it("refuses the audit's 32-bit idempotency hash (hashResult('Aa') == hashResult('BB'))", () => {
    const audit = `export function hashResult(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}`;
    expect(rules(audit)).toContain("non-cryptographic-hash");
  });

  it.each([
    "const h = Math.imul(h ^ c, 16777619);",
    "// djb2\nlet hash = 5381;",
    "for (const ch of s) h = h * 31 + ch.charCodeAt(0);",
    'createHash("md5").update(key).digest("hex")',
    "h = (h ^ s.charCodeAt(i)) >>> 0;",
  ])("refuses non-cryptographic hashes: %s", (code) => {
    expect(rules(code)).toContain("non-cryptographic-hash");
  });

  it.each([
    "// This is a demo implementation of the scheduler",
    "// In a real app you would persist the jobs",
    "throw new Error('Not implemented');",
    "// placeholder logic until the database exists",
    "/** Simplified version: no time zones. */",
  ])("refuses demo or placeholder code: %s", (code) => {
    expect(rules(code)).toContain("placeholder-code");
  });

  it("accepts cryptographic digests and ordinary code", () => {
    expect(
      rules(`import { createHash, randomUUID } from "node:crypto";
export const key = (s: string) => createHash("sha256").update(s).digest("hex");
export const id = () => randomUUID();
export const input = '<input placeholder="Search" />';
export const initials = (s: string) => s.charCodeAt(0) > 64;`),
    ).toEqual([]);
  });

  it("judges only what the model adds (a T4 correction keeps the file's own text)", () => {
    const before = "// Not implemented in the template\nexport const a = 1;";
    expect(rules(`${before}\nexport const b = 2;`, before)).toEqual([]);
  });

  it("idempotency needs persistence and a unique constraint: never a pure helper", () => {
    expect(needsPersistence("ops.idempotency")).toBe(true);
    expect(needsPersistence("data.dedup")).toBe(true);
    expect(needsPersistence("data.money")).toBe(false);
  });
});
