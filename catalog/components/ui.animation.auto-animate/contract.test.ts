import { describe, expect, it } from "vitest";
import autoAnimate from "@formkit/auto-animate";
describe("auto-animate contract", () => {
  it("exposes the animate function", () => {
    expect(typeof autoAnimate).toBe("function");
  });
});
