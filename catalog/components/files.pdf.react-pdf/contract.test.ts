import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
describe("@react-pdf/renderer contract", () => {
  it("renders an invoice-like PDF on the server", async () => {
    const pdf = await renderToBuffer(
      h(Document, null, h(Page, { size: "A4" }, h(Text, null, "Invoice #1001"))),
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 20_000);
});
