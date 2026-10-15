import { describe, expect, it } from "vitest";
import { twMerge } from "tailwind-merge";
describe("tailwind-merge contract", () => {
  it("keeps the last conflicting utility", () => {
    expect(twMerge("px-2 py-1 bg-red-500", "px-4 bg-blue-500")).toBe("py-1 px-4 bg-blue-500");
  });
});
