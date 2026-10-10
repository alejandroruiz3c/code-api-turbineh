import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
describe("qrcode contract", () => {
  it("renders an SVG QR code", async () => {
    const svg = await QRCode.toString("https://example.com", { type: "svg" });
    expect(svg.startsWith("<svg")).toBe(true);
  });
});
