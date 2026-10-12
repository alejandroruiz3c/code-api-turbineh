import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
describe("cheerio contract", () => {
  it("extracts structured data with CSS selectors", () => {
    const $ = cheerio.load(
      '<table><tr><td class="sku">A-1</td><td class="price">9.50</td></tr><tr><td class="sku">B-2</td><td class="price">12.00</td></tr></table>',
    );
    const rows = $("tr")
      .map((_, tr) => ({
        sku: $(tr).find(".sku").text(),
        price: Number($(tr).find(".price").text()),
      }))
      .get();
    expect(rows).toEqual([
      { sku: "A-1", price: 9.5 },
      { sku: "B-2", price: 12 },
    ]);
  });
});
