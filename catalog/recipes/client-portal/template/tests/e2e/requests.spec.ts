import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { OWNER_EMAIL, PASSWORD } from "./helpers";

test.describe.serial("client requests", () => {
  test("the owner submits a document request, uploads a PDF file to it and downloads it as an attachment, then updates the request's status", async ({
    page,
  }) => {
    await page.goto("/dashboard/requests");
    await page.getByLabel("Title").fill("Annual accounts review");
    await page.getByLabel("Description").fill("Please review the attached statement.");
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByRole("heading", { name: "Annual accounts review" })).toBeVisible();

    await page.getByLabel(/File \(PDF/).setInputFiles({
      name: "statement.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% test statement\n"),
    });
    await page.getByRole("button", { name: "Upload" }).click();
    const link = page.getByRole("link", { name: "statement.pdf" });
    await expect(link).toBeVisible();
    const res = await page.request.get((await link.getAttribute("href")) ?? "");
    expect(res.status()).toBe(200);
    // Served as an attachment (the browser saves the file) with exactly the uploaded bytes.
    expect(res.headers()["content-disposition"]).toContain("attachment");
    expect((await res.body()).toString()).toBe("%PDF-1.4\n% test statement\n");

    await page.getByLabel("Move to").selectOption("in_review");
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByTestId("request-status")).toHaveText("In review");
  });

  test("an HTML file disguised as a PDF is rejected", async ({ page }) => {
    await page.goto("/dashboard/requests");
    await page.getByRole("link", { name: "Annual accounts review" }).click();
    await page.getByLabel(/File \(PDF/).setInputFiles({
      name: "invoice.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("<html><script>alert(1)</script></html>"),
    });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("link", { name: "invoice.pdf" })).toHaveCount(0);
  });
});

/** Signs the client up (the E2E run raises the sign-up rate limit: AUTH_RATE_LIMIT_MAX in playwright.config.ts). */
async function signUpClient(page: Page, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Client Person");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Workspace name").fill("Client Workspace");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** The role a client holds: the app's default member role (the request's own key when roles were customised). */
const CLIENT_ROLE = existsSync("src/membership/params.json")
  ? ((JSON.parse(readFileSync("src/membership/params.json", "utf8")) as { defaultRole?: string })
      .defaultRole ?? "member")
  : "member";

/**
 * A client of the business is a member of its workspace (its default member role). Given that membership (written to the
 * database here, as an invitation would), the client submits a request, follows its status and cannot change it;
 * staff (the workspace owner) review it and update its status, and the client sees the new status.
 */
test("a client submits a request with a file and follows its status; staff review it and update the status, which the client then sees", async ({
  browser,
  page,
}) => {
  const clientEmail = `client-${Date.now()}@example.com`;
  const client = await (
    await browser.newContext({ storageState: { cookies: [], origins: [] } })
  ).newPage();
  await signUpClient(client, clientEmail);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const owner = await db.query<{ organizationId: string }>(
      `select m."organizationId" from member m join "user" u on u.id = m."userId" where u.email = $1 and m.role = 'owner' order by m."createdAt" limit 1`,
      [OWNER_EMAIL],
    );
    const org = owner.rows[0]?.organizationId;
    expect(org, "the owner's workspace exists").toBeTruthy();
    const user = await db.query<{ id: string }>(`select id from "user" where email = $1`, [
      clientEmail,
    ]);
    const clientId = user.rows[0]?.id;
    await db.query(
      `insert into member (id, "organizationId", "userId", role, "createdAt") values ($1, $2, $3, $4, now())`,
      [randomUUID(), org, clientId, CLIENT_ROLE],
    );
    await db.query(`update session set "activeOrganizationId" = $1 where "userId" = $2`, [
      org,
      clientId,
    ]);
  } finally {
    await db.end();
  }

  await client.goto("/dashboard");
  await expect(
    client.getByTestId("role"),
    "the client is a member of the business's workspace with its default (client) role",
  ).toHaveText(new RegExp(`^${CLIENT_ROLE}$`, "i"));
  await client.goto("/dashboard/requests");
  await client.getByLabel("Title").fill("Client tax documents");
  await client.getByLabel("Description").fill("Here is my statement for this year.");
  await client.getByRole("button", { name: "Submit request" }).click();
  await expect(client.getByRole("heading", { name: "Client tax documents" })).toBeVisible();
  await client.getByLabel(/File \(PDF/).setInputFiles({
    name: "client-statement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% client statement\n"),
  });
  await client.getByRole("button", { name: "Upload" }).click();
  await expect(client.getByRole("link", { name: "client-statement.pdf" })).toBeVisible();
  await expect(
    client.getByTestId("request-status"),
    "the client follows the status: submitted",
  ).toHaveText("Submitted");
  await expect(
    client.getByRole("button", { name: "Update status" }),
    "a client cannot change the status of a request",
  ).toHaveCount(0);
  const requestUrl = client.url();

  // Staff (the owner) review the client's request and update its status.
  await page.goto("/dashboard/requests");
  await page.getByRole("link", { name: "Client tax documents" }).click();
  await expect(page.getByRole("link", { name: "client-statement.pdf" })).toBeVisible();
  await page.getByLabel("Move to").selectOption("needs_info");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByTestId("request-status")).toHaveText("Needs information");

  await client.goto(requestUrl);
  await expect(
    client.getByTestId("request-status"),
    "the client sees the status staff set",
  ).toHaveText("Needs information");
  await client.context().close();
});
