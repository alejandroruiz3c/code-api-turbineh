import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as X from "@radix-ui/react-checkbox";
describe("@radix-ui/react-checkbox contract", () => {
  it("renders accessibly on the server", () => {
    expect(
      renderToString(
        h(X.Root, { defaultChecked: true, "aria-label": "Accept" }, h(X.Indicator, null, "✓")),
      ),
    ).toContain('role="checkbox"');
  });
});
