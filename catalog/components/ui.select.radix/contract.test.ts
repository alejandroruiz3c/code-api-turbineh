import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as Select from "@radix-ui/react-select";
describe("radix select contract", () => {
  it("renders a combobox trigger with its value", () => {
    const html = renderToString(h(Select.Root, { defaultValue: "eu" }, h(Select.Trigger, { "aria-label": "Region" }, h(Select.Value, { placeholder: "Pick" }))));
    expect(html).toContain('role="combobox"');
  });
});
