import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { Toaster, toast } from "sonner";
describe("sonner contract", () => {
  it("exposes a toaster and an imperative API", () => {
    expect(typeof toast.success).toBe("function");
    expect(renderToString(h(Toaster))).toContain("Notifications");
  });
});
