import { expect, test } from "@playwright/test";
import { SIGN_UP_POLICY } from "../../src/lib/sign-up-policy";
import { OWNER_EMAIL, PASSWORD, signIn } from "./helpers";

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

test("a returning user signs out, signs in again and resumes their workspace", async ({ page }) => {
  await signIn(page, OWNER_EMAIL);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("role")).toHaveText("owner");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page, OWNER_EMAIL);
  // Never sent back to "create workspace".
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("role")).toHaveText("owner");
});

test("sign-up follows the app's policy (staff-only apps refuse other emails)", async ({ page }) => {
  test.skip(SIGN_UP_POLICY !== "staff", "open sign-up: covered by the owner setup");
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Curious Visitor");
  await page.getByLabel("Email").fill(`visitor-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Workspace name").fill("Not allowed");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("reserved for staff");
  await expect(page).toHaveURL(/\/sign-up/);
});
