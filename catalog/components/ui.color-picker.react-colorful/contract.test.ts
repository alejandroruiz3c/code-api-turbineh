import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { HexColorPicker } from "react-colorful";
describe("react-colorful contract", () => {
  it("renders an accessible colour picker", () => {
    expect(renderToString(h(HexColorPicker, { color: "#0e7c6b" }))).toContain('role="slider"');
  });
});
