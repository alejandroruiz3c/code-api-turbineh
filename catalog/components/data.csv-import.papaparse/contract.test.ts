import { describe, expect, it } from "vitest";
import Papa from "papaparse";
describe("papaparse contract", () => {
  it("parses quoted CSV with headers", () => {
    const r = Papa.parse<{ name: string; notes: string }>('name,notes\n"Doe, J","a ""b"""\n', {
      header: true,
      skipEmptyLines: true,
    });
    expect(r.errors).toEqual([]);
    expect(r.data).toEqual([{ name: "Doe, J", notes: 'a "b"' }]);
  });
});
