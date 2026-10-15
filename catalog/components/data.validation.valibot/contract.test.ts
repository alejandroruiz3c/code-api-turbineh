import { describe, expect, it } from "vitest";
import * as v from "valibot";
describe("valibot contract", () => {
  it("validates and reports issues", () => {
    const Schema = v.object({
      email: v.pipe(v.string(), v.email()),
      age: v.pipe(v.number(), v.minValue(18)),
    });
    expect(v.safeParse(Schema, { email: "a@b.co", age: 30 }).success).toBe(true);
    expect(v.safeParse(Schema, { email: "nope", age: 3 }).issues?.length).toBe(2);
  });
});
