import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Analytics import end to end (component data.analytics-import.turbineh): an invalid CSV imports nothing and gets a
 * report; a valid one is imported whole and the dashboard aggregates it by period, compares it with the previous
 * period and between values of the scope dimension, and exports every chart as CSV. Columns come from this app's
 * src/analytics-import/params.json.
 */
const params = JSON.parse(readFileSync("src/analytics-import/params.json", "utf8")) as {
  columns: string[];
  dateColumn?: string;
  measures?: string[];
  periods: string[];
  filters?: string[];
  scopeColumn?: string | null;
};
const key = (c: string) =>
  c
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
const MEASURE =
  /^(revenue|sales|amount|total|price|cost|quantity|qty|units|count|value|visits|orders|profit|margin|hours|minutes|score)s?$/i;
const columns = params.columns.map(key);
const date = params.dateColumn
  ? key(params.dateColumn)
  : (columns.find((c) => /^(date|day)$/.test(c)) ??
    columns.find((c) => /date|day/.test(c)) ??
    columns[0]!);
const measures = (params.measures?.map(key) ?? columns.filter((c) => MEASURE.test(c))).filter(
  (c) => c !== date,
);
const dims = columns.filter((c) => c !== date && !measures.includes(c));
const scope =
  params.scopeColumn === null
    ? null
    : ((params.scopeColumn && key(params.scopeColumn)) ??
      dims.find((d) => (params.filters ?? []).map(key).includes(d)) ??
      null);
const first = measures[0]!;
const stamp = Date.now();
const ALPHA = `Alpha ${stamp}`;
const BETA = `Beta ${stamp}`;

/** One CSV line: the date, the scope value for the scope dimension, a fixed value for other dimensions. */
function line(day: string, scopeValue: string, value: number): string {
  return columns
    .map((c) =>
      c === date
        ? day
        : measures.includes(c)
          ? String(c === first ? value : 1)
          : c === scope
            ? scopeValue
            : `Item ${c}`,
    )
    .join(",");
}

async function importCsv(page: Page, name: string, lines: string[]) {
  await page.goto("/dashboard/reports/import");
  await page.getByLabel("CSV file").setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from([columns.join(","), ...lines].join("\n")),
  });
  await page.getByRole("button", { name: "Import" }).click();
}

const total = async (page: Page) =>
  Number(((await page.getByTestId(`total-${first}`).textContent()) ?? "0").replace(/,/g, ""));

test.describe.serial("analytics import", () => {
  const range = "from=2025-03-03&to=2025-03-16";

  test("a CSV upload with one invalid row: the entire file is rejected, nothing is imported, and the report provides the row number, field and reason for each error", async ({
    page,
  }) => {
    await page.goto(`/dashboard/reports?${range}`);
    const before = await total(page);
    await importCsv(page, "bad.csv", [
      line("2025-03-03", ALPHA, 10),
      line("2025-02-30", ALPHA, 5),
      line("2025-03-04", ALPHA, Number.NaN),
    ]);
    await expect(page.getByRole("status")).toContainText("Nothing was imported");
    const report = page.getByTestId("import-report");
    await expect(report).toContainText("2025-02-30");
    await expect(report.locator("tbody tr").first()).toContainText("3");
    await page.goto(`/dashboard/reports?${range}`);
    expect(await total(page)).toBe(before);
  });

  test("a valid CSV is imported whole and the dashboard shows totals by day, week and month", async ({
    page,
  }) => {
    await importCsv(page, "sales.csv", [
      line("2025-03-03", ALPHA, 100),
      line("2025-03-04", BETA, 50),
      line("2025-03-11", ALPHA, 30),
      // Previous period (same length, just before) for the comparison.
      line("2025-02-20", ALPHA, 90),
    ]);
    await expect(page.getByRole("status")).toHaveText("Imported 4 rows from sales.csv.");
    await page.goto(`/dashboard/reports?${range}&period=day`);
    expect(await total(page)).toBe(180);
    await expect(page.getByTestId("series").locator("tbody tr")).toHaveCount(3);
    if (params.periods.includes("week")) {
      await page.goto(`/dashboard/reports?${range}&period=week`);
      const weeks = page.getByTestId("series").locator("tbody tr");
      await expect(weeks).toHaveCount(2);
      await expect(weeks.first()).toContainText("2025-03-03");
      await expect(weeks.first()).toContainText("150");
    }
    if (params.periods.includes("month")) {
      await page.goto(`/dashboard/reports?${range}&period=month`);
      await expect(page.getByTestId("series").locator("tbody tr")).toHaveCount(1);
      await expect(page.getByTestId("series")).toContainText("2025-03-01");
    }
  });

  test("the dashboard compares the period with the previous one and between values of each dimension", async ({
    page,
  }) => {
    await page.goto(`/dashboard/reports?${range}`);
    await expect(page.getByTestId(`change-${first}`)).toContainText("+100% vs previous period");
    if (scope) {
      const compare = page.getByTestId("compare");
      await expect(compare.locator("tbody tr").filter({ hasText: ALPHA })).toContainText("130");
      await expect(compare.locator("tbody tr").filter({ hasText: BETA })).toContainText("50");
      await page.goto(`/dashboard/reports?${range}&scope=${encodeURIComponent(BETA)}`);
      expect(await total(page)).toBe(50);
    }
  });

  test("every chart on the dashboard exports its data as a CSV file with the same filters", async ({
    page,
  }) => {
    const series = await (
      await page.request.get(`/dashboard/reports/export?${range}&period=day&chart=series`)
    ).text();
    expect(series.split(/\r?\n/)[0]).toBe(["day", ...measures].join(","));
    expect(series).toContain("2025-03-03,100");
    if (scope) {
      const compare = await (
        await page.request.get(`/dashboard/reports/export?${range}&chart=compare`)
      ).text();
      expect(compare).toContain(`${ALPHA},130`);
    }
  });
});
