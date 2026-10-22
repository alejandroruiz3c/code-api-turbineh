import { expect, test, type Browser } from "@playwright/test";
import { OWNER_EMAIL, signIn } from "./helpers";

/**
 * Several organizations per person (better-auth organizations): the dashboard menu lists them, marks the active one
 * and switches with one click; the account page shows the person's profile and roles. Each test signs in with a
 * fresh session, so the stored owner session (other suites) keeps its active organization.
 */
async function freshOwner(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signIn(page, OWNER_EMAIL);
  await expect(page).toHaveURL(/\/dashboard/);
  return { context, page };
}

test("a user who belongs to several organizations switches between them from the organization selector and sees only the selected organization's workspace", async ({
  browser,
}) => {
  const { context, page } = await freshOwner(browser);
  const first = (await page.getByTestId("organization").textContent()) ?? "";
  expect(first.length).toBeGreaterThan(0);
  const second = `E2E Org ${Date.now().toString(36)}`;
  // Create another organization: the person becomes its owner and it becomes the active one.
  await page.getByRole("link", { name: "+ New organization" }).click();
  await page.getByLabel("Organization name").fill(second);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("organization")).toHaveText(second);
  await expect(page.getByTestId("role")).toHaveText("owner");
  const switcher = page.getByTestId("organization-switcher");
  await expect(switcher.locator('[aria-current="true"]')).toHaveText(second);
  // Switch back from the selector: the first organization is active again, the second one is one click away.
  await switcher
    .getByRole("button", { name: `Switch to ${first}` })
    .first()
    .click();
  await expect(page.getByTestId("organization")).toHaveText(first);
  await expect(switcher.locator('[aria-current="true"]')).toHaveText(first);
  await expect(switcher.getByRole("button", { name: `Switch to ${second}` })).toBeVisible();
  // The choice is kept on the session: another page of the dashboard shows the same organization.
  await page.goto("/dashboard");
  await expect(page.getByTestId("organization")).toHaveText(first);
  await switcher.getByRole("button", { name: `Switch to ${second}` }).click();
  await expect(page.getByTestId("organization")).toHaveText(second);
  await context.close();
});

test("a person cannot switch to an organization they do not belong to", async ({ browser }) => {
  const { context, page } = await freshOwner(browser);
  const before = (await page.getByTestId("organization").textContent()) ?? "";
  // Forge the switch form with an organization id the person is not a member of.
  const form = page.getByTestId("organization-switcher").locator("form").first();
  test.skip((await form.count()) === 0, "the owner belongs to one organization only in this run");
  await form.locator('input[name="organizationId"]').evaluate((el) => {
    (el as HTMLInputElement).value = "not-a-member-organization";
  });
  await form.getByRole("button").click();
  await page.goto("/dashboard");
  await expect(page.getByTestId("organization")).toHaveText(before);
  await context.close();
});

test("the user views their profile on the account page (name, email, organizations with their role) and updates their display name", async ({
  browser,
}) => {
  const { context, page } = await freshOwner(browser);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/account$/);
  await expect(page.getByTestId("account-email")).toHaveText(OWNER_EMAIL);
  const original = (await page.getByTestId("account-name").textContent()) ?? "";
  await expect(page.getByTestId("account-organization").first()).toContainText("Owner");
  const renamed = `${original} (renamed)`;
  await page.getByLabel("Display name").fill(renamed);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status")).toHaveText("Name saved.");
  await page.reload();
  await expect(page.getByTestId("account-name")).toHaveText(renamed);
  // Restore the shared owner's name (other suites assert it).
  await page.getByLabel("Display name").fill(original);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status")).toHaveText("Name saved.");
  await context.close();
});
