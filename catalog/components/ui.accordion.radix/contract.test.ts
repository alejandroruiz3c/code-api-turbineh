import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as Accordion from "@radix-ui/react-accordion";
describe("radix accordion contract", () => {
  it("renders an accessible accordion", () => {
    const html = renderToString(
      h(
        Accordion.Root,
        { type: "single", collapsible: true, defaultValue: "q1" },
        h(
          Accordion.Item,
          { value: "q1" },
          h(Accordion.Header, null, h(Accordion.Trigger, null, "Question?")),
          h(Accordion.Content, null, "Answer."),
        ),
      ),
    );
    expect(html).toContain("Question?");
    expect(html).toContain('aria-expanded="true"');
  });
});
