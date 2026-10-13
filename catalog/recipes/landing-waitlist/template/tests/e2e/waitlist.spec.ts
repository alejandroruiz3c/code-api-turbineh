import { expect, test } from "@playwright/test";

test.describe("public waitlist", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a visitor on the landing page submits their name and email and joins the waitlist", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Name").fill("Ada Visitor");
    await page.getByLabel("Email").fill("ada.visitor@example.com");
    await page.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(page.getByRole("status")).toContainText("You're on the list");
  });

  test("joining twice gives the same answer (no enumeration)", async ({ page }) => {
    for (let i = 0; i < 2; i++) {
      await page.goto("/");
      await page.getByLabel("Name").fill("Twice");
      await page.getByLabel("Email").fill("twice@example.com");
      await page.getByRole("button", { name: "Join the waitlist" }).click();
      await expect(page.getByRole("status")).toContainText("You're on the list");
    }
  });
});

test("the owner (admin) sees the list of waitlist signups in the dashboard", async ({ page }) => {
  await page.goto("/dashboard/waitlist");
  await expect(page.getByRole("cell", { name: "ada.visitor@example.com" })).toBeVisible();
});

test.describe("public landing", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows benefits, how it works and an FAQ", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Frequently asked questions" })).toBeVisible();
    await expect(page.locator("details").first()).toBeVisible();
  });

  test("is ready for search engines (metadata, sitemap, robots)", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(3);
    expect(await (await request.get("/llms.txt")).text()).toContain("## FAQ");
    expect(await (await request.get("/robots.txt")).text()).toContain("GPTBot");
    expect(await (await request.get("/sitemap.xml")).text()).toContain("<urlset");
    expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /dashboard");
  });
});
