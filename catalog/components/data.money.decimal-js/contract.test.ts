import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
describe("decimal.js contract", () => {
  it("avoids binary floating point errors", () => {
    expect(new Decimal("0.1").plus("0.2").toString()).toBe("0.3");
    expect(new Decimal("19.99").times(3).toFixed(2)).toBe("59.97");
  });
});
