import { expect, test } from "@playwright/test";
import { SIGN_UP_POLICY } from "../../src/lib/sign-up-policy";
import { OWNER_EMAIL, PASSWORD, signIn, signUp, verifyEmail } from "./helpers";

// These tests start signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test("a user who is not authenticated and attempts to access the dashboard is redirected to the sign-in page", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("E2E owns its URLs: auth runs on the server Playwright started, whatever the ambient BETTER_AUTH_URL", async ({
  browser,
  baseURL,
}) => {
  // playwright.config.ts sets BETTER_AUTH_URL to its own server (the gate runs with an ambient localhost:3000); the
  // setup project already signed up and in through it.
  expect(process.env.BETTER_AUTH_URL).toBe(baseURL);
  const context = await browser.newContext({ storageState: "playwright/.auth/owner.json" });
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(new RegExp(`^${baseURL}/dashboard`));
  await expect(page.getByTestId("role")).toHaveText("owner");
  await context.close();
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

test("a new user signs up: their workspace is created with them as owner, and an allowlisted email gets staff access only after the address is verified", async ({
  page,
}) => {
  // Allowlisted for this run only (playwright.config.ts): typing a staff address is not enough to become staff.
  const email = process.env.E2E_STAFF_EMAIL ?? "";
  await signUp(page, email);
  await expect(
    page.getByTestId("role"),
    "the new user's workspace is created and they are assigned the owner role",
  ).toHaveText("owner");
  await expect(page.getByTestId("staff")).toHaveText("no");
  await verifyEmail(page, email);
  await page.goto("/dashboard");
  await expect(page.getByTestId("staff")).toHaveText("yes");
});

test("the verified owner has staff access", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "playwright/.auth/owner.json" });
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page.getByTestId("staff")).toHaveText("yes");
  await context.close();
});

test("sign-up follows the app's policy (staff-only apps refuse other emails)", async ({ page }) => {
  test.skip(SIGN_UP_POLICY !== "staff", "open sign-up: covered by the owner setup");
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Curious Visitor");
  await page.getByLabel("Email").fill(`visitor-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Workspace name").fill("Not allowed");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/reserved for staff/)).toBeVisible();
  await expect(page).toHaveURL(/\/sign-up/);
});
