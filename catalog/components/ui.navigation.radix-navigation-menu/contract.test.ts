import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as Nav from "@radix-ui/react-navigation-menu";
describe("radix navigation menu contract", () => {
  it("renders site navigation", () => {
    const html = renderToString(
      h(
        Nav.Root,
        null,
        h(Nav.List, null, h(Nav.Item, null, h(Nav.Link, { href: "/about" }, "About"))),
      ),
    );
    expect(html).toContain("<nav");
    expect(html).toContain('href="/about"');
  });
});
