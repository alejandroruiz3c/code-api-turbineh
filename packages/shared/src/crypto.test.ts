import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto.js";

describe("AES-256-GCM helpers", () => {
  it("round-trips and detects tampering", () => {
    const key = randomBytes(32).toString("base64");
    const enc = encrypt("gho_secret", key);
    expect(enc).not.toContain("gho_secret");
    expect(decrypt(enc, key)).toBe("gho_secret");
    const tampered = Buffer.from(enc, "base64");
    tampered.writeUInt8((tampered.at(-1) ?? 0) ^ 1, tampered.length - 1);
    expect(() => decrypt(tampered.toString("base64"), key)).toThrow();
  });
});
