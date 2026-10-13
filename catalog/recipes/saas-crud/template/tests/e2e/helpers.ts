import { expect, type Page } from "@playwright/test";

/** The E2E owner: listed in ADMIN_EMAILS by playwright.config.ts (staff sign-up apps accept only staff). */
export const OWNER_EMAIL = "admin-e2e@example.com";
export const PASSWORD = "correct-horse-battery";

/** Signs up a fresh owner with a new workspace. */
export async function signUp(page: Page, email = `owner-${Date.now()}@example.com`): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("E2E Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Workspace name").fill("E2E Workspace");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function signIn(page: Page, email = OWNER_EMAIL): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Sign-up, or sign-in when the account already exists (re-runs against the same database). */
export async function signUpOrSignIn(page: Page, email = OWNER_EMAIL): Promise<void> {
  try {
    await signUp(page, email);
  } catch {
    await signIn(page, email);
    await expect(page).toHaveURL(/\/dashboard/);
  }
}
