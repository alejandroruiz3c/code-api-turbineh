import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as X from "@radix-ui/react-toggle-group";
describe("@radix-ui/react-toggle-group contract", () => {
  it("renders accessibly on the server", () => {
    expect(
      renderToString(
        h(
          X.Root,
          { type: "single", defaultValue: "grid" },
          h(X.Item, { value: "grid" }, "Grid"),
          h(X.Item, { value: "list" }, "List"),
        ),
      ),
    ).toContain('role="radiogroup"');
  });
});
