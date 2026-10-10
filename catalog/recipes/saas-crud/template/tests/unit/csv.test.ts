import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";

describe("csv", () => {
  it("neutralises formula injection and quotes special characters", () => {
    const out = toCsv([{ a: '=HYPERLINK("x")', b: 'say "hi", ok' }], ["a", "b"]);
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
    expect(out).toContain(`"say ""hi"", ok"`);
  });
  it("round-trips quoted fields and CRLF", () => {
    const rows = parseCsv('name,notes\r\n"Doe, J","line ""1"""\r\nAnn,\r\n');
    expect(rows).toEqual([
      { name: "Doe, J", notes: 'line "1"' },
      { name: "Ann", notes: "" },
    ]);
  });
  it("enforces limits", () => {
    expect(() => parseCsv("a\n1\n2\n3", { maxBytes: 100, maxRows: 1 })).toThrow(/too many rows/);
    expect(() => parseCsv("x".repeat(20), { maxBytes: 10, maxRows: 10 })).toThrow(/too large/);
  });
});
