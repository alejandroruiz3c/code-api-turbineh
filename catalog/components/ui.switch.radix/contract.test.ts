import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as X from "@radix-ui/react-switch";
describe("@radix-ui/react-switch contract", () => {
  it("renders accessibly on the server", () => {
    expect(renderToString(h(X.Root, { "aria-label": "Notifications" }, h(X.Thumb)))).toContain(
      'role="switch"',
    );
  });
});
