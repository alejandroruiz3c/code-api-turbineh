import { test as setup } from "@playwright/test";
import { signUp } from "./helpers";

setup("sign up the E2E owner", async ({ page }) => {
  await signUp(page);
  await page.context().storageState({ path: "playwright/.auth/owner.json" });
});
