import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
describe("pdf-lib contract", () => {
  it("creates a one-page PDF", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    page.drawText("Invoice #1", {
      font: await doc.embedFont(StandardFonts.Helvetica),
      x: 50,
      y: 700,
    });
    const bytes = await doc.save();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
