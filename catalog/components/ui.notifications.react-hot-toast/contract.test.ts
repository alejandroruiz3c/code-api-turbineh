import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import toast, { Toaster } from "react-hot-toast";
describe("react-hot-toast contract", () => {
  it("exposes the toaster and toast API", () => {
    expect(typeof toast.success).toBe("function");
    expect(renderToString(h(Toaster))).toContain("div");
  });
});
