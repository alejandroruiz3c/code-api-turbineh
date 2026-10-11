import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as Tooltip from "@radix-ui/react-tooltip";
describe("radix tooltip contract", () => {
  it("renders the trigger inside a provider", () => {
    const html = renderToString(
      h(Tooltip.Provider, null, h(Tooltip.Root, null, h(Tooltip.Trigger, null, "Help"))),
    );
    expect(html).toContain("Help");
  });
});
