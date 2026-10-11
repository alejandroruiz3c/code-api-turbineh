import { describe, expect, it } from "vitest";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
describe("fast-xml-parser contract", () => {
  it("parses and builds XML without external entities", () => {
    const data = new XMLParser().parse("<product><sku>A1</sku><price>9.5</price></product>");
    expect(data.product.sku).toBe("A1");
    expect(new XMLBuilder().build({ a: { b: 1 } })).toBe("<a><b>1</b></a>");
  });
});
