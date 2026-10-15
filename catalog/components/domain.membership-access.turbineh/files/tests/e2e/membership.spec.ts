import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { OWNER_EMAIL, PASSWORD } from "./helpers";

/** Invitations, roles and per-record scopes (component domain.membership-access.turbineh). */
type Params = {
  roles: { key: string; label: string; can: string[] }[];
  inviteRoles: string[];
  scope: { kind: string; label: string; plural: string } | null;
};
const params = JSON.parse(readFileSync("src/membership/params.json", "utf8")) as Params;
const roleOf = (key: string) => params.roles.find((r) => r.key === key);
/** The least privileged invitable role (the one a "viewer" or "client" gets). */
const invitee =
  params.inviteRoles
    .map((k) => roleOf(k))
    .filter((r): r is Params["roles"][number] => !!r && !r.can.includes("manage_members"))
    .sort((a, b) => a.can.length - b.can.length)[0] ?? params.roles[params.roles.length - 1]!;
const needsScope = !!params.scope && !invitee.can.includes("see_all_scopes");
const SCOPE_A = `E2E ${params.scope?.label ?? "Scope"} A`;
const SCOPE_B = `E2E ${params.scope?.label ?? "Scope"} B`;

/** The invitation link the app emailed to `email` (outbox recorded by playwright.config.ts). */
async function invitationLink(page: Page, email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const lines = readFileSync(process.env.EMAIL_OUTBOX_FILE ?? "", "utf8")
      .split("\n")
      .filter(Boolean);
    const link = lines
      .map((l) => JSON.parse(l) as { to: string; link?: string })
      .filter((m) => m.to === email && m.link?.includes("/invite/"))
      .at(-1)?.link;
    if (link) return new URL(link).pathname;
    await page.waitForTimeout(250);
  }
  throw new Error(`no invitation email logged for ${email}`);
}

async function inviteFromMembersPage(page: Page, email: string, scope?: string) {
  await page.goto("/dashboard/members");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Role", { exact: true }).selectOption(invitee.key);
  if (scope && params.scope)
    await page.getByLabel(params.scope.label, { exact: true }).selectOption({ label: scope });
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText(`Invitation sent to ${email}`);
}

/**
 * Submits a sign-in/sign-up form and waits for `until`; better-auth allows 3 sign-in/sign-up requests per 10 s per
 * client in production builds, so a refused attempt is retried once the window has passed.
 */
async function submitAuth(page: Page, button: string, until: RegExp) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole("button", { name: button }).click();
    try {
      await expect(page).toHaveURL(until, { timeout: 8_000 });
      return;
    } catch {
      await page.waitForTimeout(10_500);
    }
  }
  await expect(page).toHaveURL(until);
}

async function signInAs(browser: Browser, email: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await submitAuth(page, "Sign in", /\/dashboard/);
  return { context, page };
}

async function acceptAsNewAccount(browser: Browser, path: string, email: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByTestId("invite-role")).toHaveText(invitee.label);
  await page.getByRole("link", { name: "Create account" }).click();
  await page.getByLabel("Name", { exact: true }).fill("E2E Invitee");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await expect(page.getByLabel("Workspace name")).toHaveCount(0);
  await submitAuth(page, "Create account", new RegExp(path));
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return { context, page };
}

test.describe.serial("membership and access", () => {
  const email = `invitee-${Date.now()}@example.com`;
  let link = "";

  test("the owner invites a teammate by email with a role and the invitation email is sent", async ({
    page,
  }) => {
    if (needsScope && params.scope) {
      await page.goto("/dashboard/members");
      for (const name of [SCOPE_A, SCOPE_B]) {
        await page.getByLabel(`New ${params.scope.label.toLowerCase()}`).fill(name);
        await page.getByRole("button", { name: `Add ${params.scope.label.toLowerCase()}` }).click();
        await expect(page.getByTestId("scope-row").filter({ hasText: name })).toBeVisible();
      }
    }
    await inviteFromMembersPage(page, email, needsScope ? SCOPE_A : undefined);
    await page.reload();
    await expect(page.getByTestId("invitation-row").filter({ hasText: email })).toContainText(
      invitee.label,
    );
    link = await invitationLink(page, email);
    expect(link).toMatch(/^\/invite\/[\w-]{40,}$/);
  });

  test("the invited person creates an account from the link, accepts and joins with the invited role", async ({
    browser,
  }) => {
    const { context, page } = await acceptAsNewAccount(browser, link, email);
    await expect(page.getByTestId("role")).toHaveText(invitee.key);
    await page.goto("/dashboard/members");
    await expect(page.getByTestId("my-role")).toHaveText(invitee.label);
    await context.close();
  });

  test("a member whose role cannot manage the workspace cannot invite people or change roles", async ({
    browser,
  }) => {
    const { context, page } = await signInAs(browser, email);
    await page.goto("/dashboard/members");
    await expect(page.getByText("Only members who manage the workspace")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send invitation" })).toHaveCount(0);
    await context.close();
  });

  test("an invitation link works only once and only for the invited email", async ({
    page,
    browser,
  }) => {
    // Used link: refused.
    const used = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const usedPage = await used.newPage();
    await usedPage.goto(link);
    await expect(usedPage.getByText("This invitation was already used.")).toBeVisible();
    await used.close();
    // Another person's link opened by the signed-in owner: refused.
    const other = `other-${Date.now()}@example.com`;
    await inviteFromMembersPage(page, other, needsScope ? SCOPE_B : undefined);
    await page.goto(await invitationLink(page, other));
    await expect(page.getByText(`You are signed in as ${OWNER_EMAIL}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
  });

  test("a member restricted to their own company sees only that company, never the others", async ({
    browser,
  }) => {
    test.skip(!needsScope, "no per-record scope in this app's roles");
    const { context, page } = await signInAs(browser, email);
    await page.goto("/dashboard/members");
    await expect(page.getByTestId("my-scopes")).toContainText(SCOPE_A);
    await expect(page.getByTestId("my-scopes")).not.toContainText(SCOPE_B);
    await context.close();
  });
  test("the owner changes a member's role", async ({ page }) => {
    const target = params.inviteRoles.find((k) => k !== invitee.key);
    test.skip(!target, "only one invitable role");
    await page.goto("/dashboard/members");
    const row = page.getByTestId("member-row").filter({ hasText: email });
    await row.getByLabel(`Role of ${email}`).selectOption(target!);
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row.getByRole("status")).toHaveText("Role changed.");
  });
});
