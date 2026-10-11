import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as Popover from "@radix-ui/react-popover";
describe("radix popover contract", () => {
  it("renders a dialog trigger", () => {
    const html = renderToString(h(Popover.Root, null, h(Popover.Trigger, null, "Open")));
    expect(html).toContain('aria-haspopup="dialog"');
  });
});
