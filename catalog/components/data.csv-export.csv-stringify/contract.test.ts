import { describe, expect, it } from "vitest";
import { stringify } from "csv-stringify/sync";
describe("csv-stringify contract", () => {
  it("serialises with header and quoting", () => {
    expect(stringify([{ a: "x,y", b: 1 }], { header: true })).toBe('a,b\n"x,y",1\n');
  });
});
