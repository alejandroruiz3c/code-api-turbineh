import { describe, expect, it } from "vitest";
import currency from "currency.js";
describe("currency.js contract", () => {
  it("adds money without floating point errors", () => {
    expect(currency(0.1).add(0.2).value).toBe(0.3);
    expect(currency(19.99).multiply(3).format()).toBe("$59.97");
  });
});
