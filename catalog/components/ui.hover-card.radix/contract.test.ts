import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as X from "@radix-ui/react-hover-card";
describe("@radix-ui/react-hover-card contract", () => {
  it("renders accessibly on the server", () => {
    expect(renderToString(h(X.Root, null, h(X.Trigger, { href: "/u/1" }, "Ada")))).toContain("Ada");
  });
});
