import { expect, test } from "@playwright/test";

test.describe("public waitlist", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a visitor joins the waitlist", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Name").fill("Ada Visitor");
    await page.getByLabel("Email").fill("ada.visitor@example.com");
    await page.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(page.getByRole("status")).toContainText("You're on the list");
  });

  test("joining twice gives the same answer (no enumeration)", async ({ page }) => {
    for (let i = 0; i < 2; i++) {
      await page.goto("/");
      await page.getByLabel("Name").fill("Twice");
      await page.getByLabel("Email").fill("twice@example.com");
      await page.getByRole("button", { name: "Join the waitlist" }).click();
      await expect(page.getByRole("status")).toContainText("You're on the list");
    }
  });
});

test("the admin sees waitlist signups", async ({ page }) => {
  await page.goto("/dashboard/waitlist");
  await expect(page.getByRole("cell", { name: "ada.visitor@example.com" })).toBeVisible();
});
