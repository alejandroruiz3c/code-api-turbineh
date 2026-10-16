import { existsSync, readFileSync } from "node:fs";
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
  // The E2E run raises better-auth's sign-up limit (AUTH_RATE_LIMIT_MAX, playwright.config.ts): no waiting.
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function signIn(page: Page, email = OWNER_EMAIL): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Opens the verification link the app sent to `email`. Without an email provider the app logs emails; the test run
 * records that log in EMAIL_OUTBOX_FILE (playwright.config.ts). No test-only code path in the app.
 */
export async function verifyEmail(page: Page, email: string): Promise<void> {
  const file = process.env.EMAIL_OUTBOX_FILE ?? "";
  let link: string | undefined;
  for (let i = 0; i < 20 && !link; i++) {
    if (existsSync(file)) {
      link = readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { to: string; link?: string })
        .filter((m) => m.to === email && m.link)
        .at(-1)?.link;
    }
    if (!link) await page.waitForTimeout(250);
  }
  if (!link) throw new Error(`no verification email logged for ${email}`);
  await page.goto(link);
}

/** Sign-up, or sign-in when the account already exists (re-runs against the same database). */
export async function signUpOrSignIn(page: Page, email = OWNER_EMAIL): Promise<void> {
  try {
    await signUp(page, email);
    await verifyEmail(page, email);
    await page.goto("/dashboard");
  } catch {
    await signIn(page, email);
    await expect(page).toHaveURL(/\/dashboard/);
  }
}
