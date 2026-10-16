import { expect, test } from "@playwright/test";

test.describe.serial("trackers", () => {
  test("a habit: check in today starts a streak", async ({ page }) => {
    await page.goto("/dashboard/trackers");
    await page.getByLabel("Name").fill("Meditate");
    await page.getByLabel("Type").selectOption("habit");
    await page.getByRole("button", { name: "Create tracker" }).click();
    await expect(page.getByRole("heading", { name: "Meditate" })).toBeVisible();
    await page.getByRole("button", { name: "Mark as done" }).click();
    await expect(page.locator('[data-stat="Today"]')).toHaveText("Done ✓");
    await expect(page.locator('[data-stat="Streak"]')).toHaveText("1 days");
  });

  test("an amount: logs add up towards the daily goal", async ({ page }) => {
    await page.goto("/dashboard/trackers");
    await page.getByLabel("Name").fill("Running");
    await page.getByLabel("Type").selectOption("quantity");
    await page.getByLabel("Daily goal").fill("5");
    await page.getByLabel("Unit").fill("km");
    await page.getByRole("button", { name: "Create tracker" }).click();
    for (const v of ["2.5", "3"]) {
      await page.getByLabel(/^Amount/).fill(v);
      await page.getByRole("button", { name: "Add" }).click();
      await expect(page.locator('[data-stat="Today"]')).toContainText(
        v === "3" ? "5.5 / 5 km" : "2.5 / 5 km",
      );
    }
    await expect(page.locator('[data-stat="Streak"]')).toHaveText("1 days");
    await page.goto("/dashboard/trackers");
    await expect(page.locator('[data-streak="Running"]')).toContainText("1 day streak");
  });

  test("an amount: the weekly total adds up the logs of the last 7 days and the 30-day history marks today as goal met", async ({
    page,
  }) => {
    await page.goto("/dashboard/trackers");
    await page.getByRole("link", { name: "Running" }).first().click();
    await expect(page.getByRole("heading", { name: "Running" })).toBeVisible();
    await expect(
      page.locator('[data-stat="Last 7 days"]'),
      "the weekly total is the sum of this week's logs (2.5 + 3 km)",
    ).toHaveText("5.5 km");
    const days = page.getByRole("list", { name: "Last 30 days" }).getByRole("listitem");
    await expect(days, "the history shows the last 30 days").toHaveCount(30);
    await expect(days.last(), "today's goal is marked as met in the history").toHaveAttribute(
      "aria-label",
      /goal met$/,
    );
    await expect(page.locator('[data-stat="Goal met (30 days)"]')).toHaveText("3%");
  });
});
