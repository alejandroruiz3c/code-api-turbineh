import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
describe("qrcode.react contract", () => {
  it("renders a QR code as SVG", () => {
    expect(renderToString(h(QRCodeSVG, { value: "https://example.com/t/123" }))).toContain("<svg");
  });
});
