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
});
