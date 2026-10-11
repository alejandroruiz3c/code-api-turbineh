import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { Button, Label, TextField, Input } from "react-aria-components";
describe("react-aria-components contract", () => {
  it("renders accessible fields and buttons", () => {
    const html = renderToString(h("div", null, h(TextField, null, h(Label, null, "Email"), h(Input)), h(Button, null, "Save")));
    expect(html).toContain("Email");
    expect(html).toContain("Save");
  });
});
