import { expect, test } from "@playwright/test";
import { connect, mockRequests, query } from "./social-helpers";

/**
 * Social accounts end to end (social.connections.turbineh), offline against the LinkedIn, Meta Graph and X mocks: the
 * real OAuth flows through each provider's consent page, encrypted storage and revocation.
 */
const TOKEN_SHAPES = /li-access-|fb-user-|fb-page-|x-access-|x-refresh-/;

test.describe.serial("social accounts", () => {
  test("a workspace owner connects LinkedIn, Facebook Pages with their Instagram account, and X through each provider's OAuth consent page", async ({
    page,
  }) => {
    await connect(page, "linkedin");
    await expect(
      page.getByTestId("social-connection").filter({ hasText: "Ada Lovelace" }),
    ).toContainText("Connected");
    await connect(page, "meta");
    await expect(page.getByRole("status")).toContainText("Connected 2 account(s)");
    await expect(
      page.getByTestId("social-connection").filter({ hasText: "Sunny Bakery" }),
    ).toContainText("Facebook Page");
    await expect(
      page.getByTestId("social-connection").filter({ hasText: "Instagram" }),
    ).toContainText("@sunnybakery");
    await connect(page, "x");
    const x = page
      .getByTestId("social-connection")
      .filter({ has: page.getByRole("cell", { name: "X", exact: true }) });
    await expect(x).toContainText("@sunnybakery");
    // The X flow used PKCE (S256) and a confidential client, as X documents it.
    const xLog = await mockRequests(page.request, "X_API_BASE");
    expect(xLog.find((r) => r.path === "/i/oauth2/authorize")?.query.code_challenge_method).toBe(
      "S256",
    );
    expect(xLog.find((r) => r.path === "/2/oauth2/token")?.headers.authorization).toMatch(
      /^Basic /,
    );
  });

  test("access tokens are stored encrypted (AES-256-GCM) and never appear on a page", async ({
    page,
  }) => {
    const rows = await query<{
      network: string;
      access: string;
      refresh: string | null;
      grant: string | null;
    }>(
      "select network, access_token_sealed as access, refresh_token_sealed as refresh, grant_token_sealed as grant from social_connections where status = 'active'",
    );
    expect(rows.map((r) => r.network).sort()).toEqual(["facebook", "instagram", "linkedin", "x"]);
    for (const r of rows) {
      for (const sealed of [r.access, r.refresh, r.grant].filter((v): v is string => v !== null)) {
        expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
        expect(sealed).not.toMatch(TOKEN_SHAPES);
      }
    }
    await page.goto("/dashboard/social");
    expect(await page.content()).not.toMatch(TOKEN_SHAPES);
  });

  test("the OAuth callback refuses a state it did not issue to this person (single use)", async ({
    page,
  }) => {
    await page.goto("/api/social/oauth/x/callback?code=forged&state=forged-state-value");
    await expect(page).toHaveURL(/\/dashboard\/social\?error=/);
    await expect(page.locator(`p[role="alert"]`)).toContainText("expired or was already used");
  });

  test("disconnecting an account revokes its tokens at the provider and deletes them here", async ({
    page,
  }) => {
    await page.goto("/dashboard/social");
    const row = page
      .getByTestId("social-connection")
      .filter({ has: page.getByRole("cell", { name: "X", exact: true }) });
    await row.getByRole("button", { name: /Disconnect/ }).click();
    await expect(page.getByRole("status")).toContainText("access revoked at the provider");
    const revokes = (await mockRequests(page.request, "X_API_BASE")).filter(
      (r) => r.path === "/2/oauth2/revoke",
    );
    expect(revokes.length).toBeGreaterThanOrEqual(2); // refresh and access tokens
    const [x] = await query<{ status: string; access: string; refresh: string | null }>(
      "select status, access_token_sealed as access, refresh_token_sealed as refresh from social_connections where network = 'x'",
    );
    expect(x).toEqual({ status: "revoked", access: "", refresh: null });
  });
});
