import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as X from "@radix-ui/react-alert-dialog";
describe("@radix-ui/react-alert-dialog contract", () => {
  it("renders accessibly on the server", () => {
    expect(renderToString(h(X.Root, null, h(X.Trigger, null, "Delete")))).toContain("Delete");
  });
});
