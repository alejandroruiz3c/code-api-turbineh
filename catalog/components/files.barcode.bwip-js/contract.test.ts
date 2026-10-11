import { describe, expect, it } from "vitest";
import bwipjs from "bwip-js/node";
describe("bwip-js contract", () => {
  it("renders an EAN-13 barcode as SVG", () => {
    const svg = bwipjs.toSVG({ bcid: "ean13", text: "5901234123457" });
    expect(svg).toContain("<svg");
  });
});
