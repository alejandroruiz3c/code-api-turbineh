import { describe, expect, it } from "vitest";
import { nanoid, customAlphabet } from "nanoid";
describe("nanoid contract", () => {
  it("generates url-safe unique ids", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => nanoid()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(customAlphabet("0123456789", 6)()).toMatch(/^\d{6}$/);
  });
});
