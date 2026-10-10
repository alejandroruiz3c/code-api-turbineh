import { describe, expect, it } from "vitest";
import { toVector } from "./client.js";

describe("toVector", () => {
  it("formats a pgvector literal", () => {
    expect(toVector([0.1, -2, 3])).toBe("[0.1,-2,3]");
  });
});
