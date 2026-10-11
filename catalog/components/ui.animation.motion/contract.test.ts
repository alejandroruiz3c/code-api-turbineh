import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { motion } from "motion/react";
describe("motion contract", () => {
  it("renders animated elements on the server", () => {
    const html = renderToString(
      h(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 } }, "Hello"),
    );
    expect(html).toContain("Hello");
  });
});
