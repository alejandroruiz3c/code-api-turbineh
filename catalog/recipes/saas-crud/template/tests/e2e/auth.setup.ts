import { test as setup } from "@playwright/test";
import { OWNER_EMAIL, signUpOrSignIn } from "./helpers";

/** One owner (a staff email, see playwright.config.ts) signs up once; feature tests reuse the stored session. */
setup("sign up the E2E owner", async ({ page }) => {
  await signUpOrSignIn(page, OWNER_EMAIL);
  await page.context().storageState({ path: "playwright/.auth/owner.json" });
});
