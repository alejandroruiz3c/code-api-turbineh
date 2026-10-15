import { describe, expect, it } from "vitest";
import { AnalyticsParams, analyticsParams, toDataset } from "@/analytics-import/config";
import {
  change,
  parseCsv,
  periodStart,
  previousRange,
  validateCsv,
} from "@/analytics-import/rules";

/** Contract of data.analytics-import.turbineh: column roles, all-or-nothing validation, periods and comparisons. */
const ds = toDataset({
  columns: ["date", "shop", "product", "quantity", "revenue"],
  periods: ["day", "week", "month"],
  filters: ["date range", "shop"],
});

describe("analytics import", () => {
  it("the shipped params are valid; columns are read as date, dimensions and measures", () => {
    expect(AnalyticsParams.safeParse(analyticsParams).success).toBe(true);
    expect(ds).toMatchObject({
      date: "date",
      measures: ["quantity", "revenue"],
      dimensions: ["shop", "product"],
      scope: "shop",
    });
  });

  it("parses quoted CSV fields with commas, quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });

  it("rejects the whole file when any row is invalid, with the line, column and reason of each problem", () => {
    const file = [
      "date,shop,product,quantity,revenue",
      "2026-10-01,Centro,Latte,3,9.5",
      "2026-02-30,Centro,Latte,3,9.5",
      "2026-10-02,,Latte,x,-1",
    ].join("\n");
    const r = validateCsv(file, ds);
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => [e.line, e.column])).toEqual([
      [3, "date"],
      [4, "quantity"],
      [4, "revenue"],
      [4, "shop"],
    ]);
    expect(validateCsv("date,shop\n2026-10-01,Centro", ds).errors[0]?.message).toMatch(
      /Missing column/,
    );
  });

  it("accepts a valid file whole, and refuses rows of shops the importer may not see", () => {
    const file =
      "date,shop,product,quantity,revenue\n2026-10-01,Centro,Latte,3,9.5\n2026-10-01,Norte,Mocha,1,4";
    expect(validateCsv(file, ds).rows).toHaveLength(2);
    const mine = validateCsv(file, ds, new Set(["centro"]));
    expect(mine.rows).toEqual([]);
    expect(mine.errors).toEqual([
      { line: 3, column: "shop", message: '"Norte" is not one of your shop values' },
    ]);
  });

  it("groups days into weeks from Monday, months and quarters, and compares with the previous period", () => {
    expect(periodStart("2026-10-15", "week")).toBe("2026-10-12");
    expect(periodStart("2026-10-15", "month")).toBe("2026-10-01");
    expect(periodStart("2026-11-15", "quarter")).toBe("2026-10-01");
    expect(previousRange("2026-10-08", "2026-10-14")).toEqual({
      from: "2026-10-01",
      to: "2026-10-07",
    });
    expect(change(150, 100)).toBe(50);
    expect(change(5, 0)).toBeNull();
  });
});
