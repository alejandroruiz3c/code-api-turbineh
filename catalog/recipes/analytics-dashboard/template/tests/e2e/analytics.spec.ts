import { expect, test } from "@playwright/test";

const csv =
  "date,category,value\n2026-03-01,Online,100.50\n2026-03-02,Store,49.50\n2026-03-02,Online,50\nnot-a-date,Online,1\n";

test.describe.serial("analytics", () => {
  test("the owner imports a CSV, the invalid row is rejected, and the dashboard shows exact KPIs and charts", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");
    await page.getByLabel("Name").fill("Sales");
    await page.getByLabel("Unit").fill("EUR");
    await page.getByRole("button", { name: "Create dataset" }).click();
    await expect(page.getByRole("heading", { name: "Sales" })).toBeVisible();
    await page
      .getByLabel("CSV file")
      .setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByRole("status")).toContainText("Imported 3 rows, rejected 1");
    await page.locator("#f-from").fill("2026-03-01");
    await page.locator("#f-to").fill("2026-03-02");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.locator('[data-kpi="Total"]')).toHaveText("200 EUR");
    await expect(page.locator('[data-kpi="Entries"]')).toHaveText("3");
    await expect(page.getByRole("img", { name: /Sales daily total/ })).toBeVisible();
    await expect(page.getByLabel("Breakdown by category")).toContainText("Online");
  });

  test("the dashboard filters by category and exports the filtered data as a CSV file", async ({
    page,
    request,
  }) => {
    await page.goto("/dashboard/analytics");
    await page.getByRole("link", { name: "Sales", exact: true }).click();
    await page.locator("#f-from").fill("2026-03-01");
    await page.locator("#f-to").fill("2026-03-02");
    await page.locator("#f-cat").fill("Store");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.locator('[data-kpi="Total"]')).toHaveText("49.5 EUR");
    const href = (await page.getByRole("link", { name: "Export CSV" }).getAttribute("href")) ?? "";
    const body = await (await request.get(href)).text();
    expect(body).toContain("2026-03-02,Store,49.50");
    expect(body).not.toContain("Online");
  });
  test("the owner enters a value by hand and the KPIs compare the period with the previous period of the same length", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");
    await page.getByRole("link", { name: "Sales", exact: true }).click();
    // 2026-02-27..28 is the period right before 2026-03-01..02 (same length).
    await page.locator("#p-day").fill("2026-02-28");
    await page.locator("#p-cat").fill("Store");
    await page.locator("#p-val").fill("100");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "2026-02-28" }),
      "the value entered by hand is stored and listed",
    ).toBeVisible();
    await page.locator("#f-from").fill("2026-03-01");
    await page.locator("#f-to").fill("2026-03-02");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.locator('[data-kpi="Total"]')).toHaveText("200 EUR");
    await expect(
      page.locator('[data-kpi="vs previous period"]'),
      "the KPI compares 200 with the previous period's 100: +100%",
    ).toHaveText("+100%");
    await page.locator("#f-from").fill("2026-02-27");
    await page.locator("#f-to").fill("2026-02-28");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(
      page.locator('[data-kpi="Total"]'),
      "the value entered by hand counts in its own period's total",
    ).toHaveText("100 EUR");
  });
});
