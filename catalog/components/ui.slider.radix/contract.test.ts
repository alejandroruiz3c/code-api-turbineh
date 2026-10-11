import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as X from "@radix-ui/react-slider";
describe("@radix-ui/react-slider contract", () => {
  it("renders accessibly on the server", () => {
    expect(
      renderToString(
        h(
          X.Root,
          { defaultValue: [20], max: 100, "aria-label": "Price" },
          h(X.Track, null, h(X.Range)),
          h(X.Thumb),
        ),
      ),
    ).toContain('role="slider"');
  });
});
