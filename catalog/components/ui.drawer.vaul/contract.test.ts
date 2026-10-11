import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { Drawer } from "vaul";
describe("vaul contract", () => {
  it("renders a drawer trigger", () => {
    const html = renderToString(h(Drawer.Root, null, h(Drawer.Trigger, null, "Cart")));
    expect(html).toContain("Cart");
  });
});
