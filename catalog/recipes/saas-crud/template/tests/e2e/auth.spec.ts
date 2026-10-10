import { expect, test } from "@playwright/test";

// These tests start signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test("dashboard requires sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("the stored owner session reaches the dashboard as owner", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "playwright/.auth/owner.json" });
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page.getByTestId("role")).toHaveText("owner");
  await context.close();
});
