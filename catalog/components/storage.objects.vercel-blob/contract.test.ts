import { describe, expect, it } from "vitest";
import { put, del, list } from "@vercel/blob";
describe("vercel blob contract", () => {
  it("exposes put, list and delete", () => {
    expect([put, del, list].every((f) => typeof f === "function")).toBe(true);
  });
});
