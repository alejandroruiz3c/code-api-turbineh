import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import useEmblaCarousel from "embla-carousel-react";
function Carousel() {
  const [ref] = useEmblaCarousel({ loop: true });
  return h(
    "div",
    { ref, className: "embla" },
    h("div", null, h("div", null, "Slide 1"), h("div", null, "Slide 2")),
  );
}
describe("embla-carousel-react contract", () => {
  it("renders slides on the server", () => {
    expect(renderToString(h(Carousel))).toContain("Slide 2");
  });
});
