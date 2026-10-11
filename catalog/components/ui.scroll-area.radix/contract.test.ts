import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as X from "@radix-ui/react-scroll-area";
describe("@radix-ui/react-scroll-area contract", () => {
  it("renders accessibly on the server", () => {
    expect(renderToString(h(X.Root, null, h(X.Viewport, null, "Long content")))).toContain(
      "Long content",
    );
  });
});
