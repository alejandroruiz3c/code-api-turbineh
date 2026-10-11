import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as X from "@radix-ui/react-avatar";
describe("@radix-ui/react-avatar contract", () => {
  it("renders accessibly on the server", () => {
    expect(renderToString(h(X.Root, null, h(X.Fallback, null, "AR")))).toContain("AR");
  });
});
