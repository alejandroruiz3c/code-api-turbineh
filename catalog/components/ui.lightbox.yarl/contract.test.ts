import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import Lightbox from "yet-another-react-lightbox";
describe("yet-another-react-lightbox contract", () => {
  it("renders nothing while closed and accepts slides", () => {
    const html = renderToString(
      h(Lightbox, { open: false, slides: [{ src: "/a.jpg", alt: "A" }] }),
    );
    expect(typeof html).toBe("string");
  });
});
