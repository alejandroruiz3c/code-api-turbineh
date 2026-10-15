import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { Command } from "cmdk";
describe("cmdk contract", () => {
  it("server-renders a command list", () => {
    const html = renderToString(
      h(
        Command,
        { label: "Menu" },
        h(Command.Input),
        h(Command.List, null, h(Command.Item, null, "Open")),
      ),
    );
    expect(html).toContain("cmdk-input");
  });
});
