import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
describe("exceljs contract", () => {
  it("writes and reads back an xlsx buffer", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Items").addRows([
      ["sku", "qty"],
      ["A-1", 3],
    ]);
    const buf = await wb.xlsx.writeBuffer();
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf);
    expect(back.getWorksheet("Items")?.getCell("B2").value).toBe(3);
  });
});
