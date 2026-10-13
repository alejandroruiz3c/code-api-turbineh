import { describe, expect, it } from "vitest";
import { formatTitle } from "./format";

describe("formatTitle", () => {
  it("capitalises words", () => {
    expect(formatTitle("acme notes")).toBe("Acme Notes");
  });
});
