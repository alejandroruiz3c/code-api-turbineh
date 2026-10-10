import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { Check } from "lucide-react";
describe("lucide-react contract", () => {
  it("renders an accessible SVG icon", () => {
    expect(renderToString(h(Check, { "aria-label": "done" }))).toMatch(/^<svg/);
  });
});
