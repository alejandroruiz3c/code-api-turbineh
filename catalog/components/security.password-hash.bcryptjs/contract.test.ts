import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
describe("bcryptjs contract", () => {
  it("hashes and verifies", async () => {
    const hash = await bcrypt.hash("correct horse", 10);
    expect(await bcrypt.compare("correct horse", hash)).toBe(true);
    expect(await bcrypt.compare("wrong", hash)).toBe(false);
  });
});
