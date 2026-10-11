import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as Menu from "@radix-ui/react-dropdown-menu";
describe("radix dropdown menu contract", () => {
  it("renders a trigger with menu semantics", () => {
    const html = renderToString(h(Menu.Root, null, h(Menu.Trigger, null, "Options")));
    expect(html).toContain('aria-haspopup="menu"');
  });
});
