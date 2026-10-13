import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { OWNER_EMAIL, PASSWORD } from "./helpers";

/**
 * Per-scope private files (storage.private-uploads.turbineh with domain.membership-access.turbineh): a member
 * restricted to one scope (a client's company) downloads only that scope's files, staff see every scope, and staff are
 * emailed when such a member uploads (when the app's params ask for it).
 */
type Membership = {
  roles: { key: string; label: string; can: string[] }[];
  inviteRoles: string[];
  scope: { label: string } | null;
};
const membership = JSON.parse(readFileSync("src/membership/params.json", "utf8")) as Membership;
const uploadsParams = JSON.parse(readFileSync("src/uploads/params.json", "utf8")) as {
  types: string[];
  notifyOnUpload: boolean;
};
const restricted = membership.inviteRoles
  .map((k) => membership.roles.find((r) => r.key === k))
  .find((r) => r && !r.can.includes("see_all_scopes") && r.can.includes("create"));
const scopeLabel = membership.scope?.label ?? "";
const stamp = Date.now();
const MINE = `Uploads ${scopeLabel} ${stamp} A`;
const OTHER = `Uploads ${scopeLabel} ${stamp} B`;

function pdf(name: string) {
  return {
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(`%PDF-1.7\n% ${name}\n1 0 obj\n<<>>\nendobj\n%%EOF\n`),
  };
}

function outbox(): { to: string; subject: string; link?: string }[] {
  return readFileSync(process.env.EMAIL_OUTBOX_FILE ?? "", "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { to: string; subject: string; link?: string });
}

/** better-auth allows 3 sign-in/sign-up requests per 10 s per client in production builds: retry after the window. */
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

async function uploadTo(page: Page, file: ReturnType<typeof pdf>, scope?: string) {
  await page.goto("/dashboard/files");
  await page.getByLabel("File", { exact: true }).setInputFiles(file);
  if (scope) await page.getByLabel(scopeLabel, { exact: true }).selectOption({ label: scope });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("status")).toHaveText(`Uploaded ${file.name}.`);
}

async function joinAs(browser: Browser, link: string, email: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(link);
  await page.getByRole("link", { name: "Create account" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Scoped Client");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await submitAuth(page, "Create account", new RegExp(link));
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return { context, page };
}

test.describe.serial("private files per scope", () => {
  test.skip(
    !membership.scope || !restricted || !uploadsParams.types.includes("pdf"),
    "no scope-restricted role that can upload PDFs in this app",
  );
  const client = `scoped-${stamp}@example.com`;
  let otherHref = "";
  let link = "";

  test("staff file a document under one client and invite another client's member", async ({
    page,
  }) => {
    await page.goto("/dashboard/members");
    for (const name of [MINE, OTHER]) {
      await page.getByLabel(`New ${scopeLabel.toLowerCase()}`).fill(name);
      await page.getByRole("button", { name: `Add ${scopeLabel.toLowerCase()}` }).click();
      await expect(page.getByTestId("scope-row").filter({ hasText: name })).toBeVisible();
    }
    const other = pdf(`other-${stamp}.pdf`);
    await uploadTo(page, other, OTHER);
    await page.reload();
    otherHref =
      (await page
        .getByTestId("file-row")
        .filter({ hasText: other.name })
        .getByRole("link")
        .getAttribute("href")) ?? "";
    expect(otherHref).toMatch(/\/download$/);
    await page.goto("/dashboard/members");
    await page.getByLabel("Email", { exact: true }).fill(client);
    await page.getByLabel("Role", { exact: true }).selectOption(restricted!.key);
    await page.getByLabel(scopeLabel, { exact: true }).selectOption({ label: MINE });
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("status")).toContainText(`Invitation sent to ${client}`);
    for (let i = 0; i < 20 && !link; i++) {
      const found = outbox()
        .filter((m) => m.to === client && m.link?.includes("/invite/"))
        .at(-1)?.link;
      if (found) link = new URL(found).pathname;
      else await page.waitForTimeout(250);
    }
    expect(link).toMatch(/^\/invite\//);
  });

  test("a client downloads only their own company's files, never another company's", async ({
    browser,
  }) => {
    const { context, page } = await joinAs(browser, link, client);
    await page.goto("/dashboard/files");
    await expect(
      page.getByTestId("file-row").filter({ hasText: `other-${stamp}.pdf` }),
    ).toHaveCount(0);
    expect((await page.request.get(otherHref)).status()).toBe(404);
    const mine = pdf(`mine-${stamp}.pdf`);
    await uploadTo(page, mine);
    await page.reload();
    const href = await page
      .getByTestId("file-row")
      .filter({ hasText: mine.name })
      .getByRole("link")
      .getAttribute("href");
    const res = await page.request.get(href ?? "");
    expect(res.status()).toBe(200);
    expect(Buffer.from(await res.body()).equals(mine.buffer)).toBe(true);
    await context.close();
  });

  test("staff see every client's files and are emailed when a client uploads", async ({ page }) => {
    await page.goto("/dashboard/files");
    await expect(
      page.getByTestId("file-row").filter({ hasText: `mine-${stamp}.pdf` }),
    ).toBeVisible();
    await expect(
      page.getByTestId("file-row").filter({ hasText: `other-${stamp}.pdf` }),
    ).toBeVisible();
    test.skip(!uploadsParams.notifyOnUpload, "this app does not email staff on upload");
    const mail = outbox().find(
      (m) =>
        m.to === OWNER_EMAIL &&
        m.subject.includes(client) &&
        m.subject.includes(`mine-${stamp}.pdf`),
    );
    expect(mail).toBeTruthy();
  });
});
