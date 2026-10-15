import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as X from "@radix-ui/react-progress";
describe("@radix-ui/react-progress contract", () => {
  it("renders accessibly on the server", () => {
    expect(renderToString(h(X.Root, { value: 40 }, h(X.Indicator)))).toContain(
      'role="progressbar"',
    );
  });
});
