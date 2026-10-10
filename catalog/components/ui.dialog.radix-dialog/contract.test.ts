import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as Dialog from "@radix-ui/react-dialog";
describe("@radix-ui/react-dialog contract", () => {
  it("renders an accessible trigger", () => {
    const html = renderToString(h(Dialog.Root, null, h(Dialog.Trigger, null, "Open")));
    expect(html).toContain('aria-haspopup="dialog"');
  });
});
