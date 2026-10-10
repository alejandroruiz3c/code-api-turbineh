import { test as setup } from "@playwright/test";
import { signUp } from "./helpers";

/** The E2E owner is the waitlist admin (ADMIN_EMAILS in the sandbox contains this address). */
setup("sign up the E2E admin", async ({ page }) => {
  await signUp(page, "admin-e2e@example.com");
  await page.context().storageState({ path: "playwright/.auth/owner.json" });
});
