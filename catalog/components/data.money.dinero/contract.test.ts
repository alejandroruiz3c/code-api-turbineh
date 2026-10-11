import { describe, expect, it } from "vitest";
import { dinero, add, allocate, toSnapshot } from "dinero.js";
import { EUR } from "dinero.js/currencies";
describe("dinero.js contract", () => {
  it("adds and allocates money in minor units", () => {
    const total = add(dinero({ amount: 1000, currency: EUR }), dinero({ amount: 99, currency: EUR }));
    expect(toSnapshot(total).amount).toBe(1099);
    expect(allocate(dinero({ amount: 100, currency: EUR }), [1, 2]).map((d) => toSnapshot(d).amount)).toEqual([33, 67]);
  });
});
