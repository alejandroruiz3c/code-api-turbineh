import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as Tabs from "@radix-ui/react-tabs";
describe("radix tabs contract", () => {
  it("renders tabs with roles", () => {
    const html = renderToString(
      h(Tabs.Root, { defaultValue: "a" }, h(Tabs.List, null, h(Tabs.Trigger, { value: "a" }, "A"), h(Tabs.Trigger, { value: "b" }, "B")), h(Tabs.Content, { value: "a" }, "Panel A")),
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Panel A");
  });
});
