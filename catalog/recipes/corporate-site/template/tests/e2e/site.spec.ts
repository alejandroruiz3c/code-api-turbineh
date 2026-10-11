import { expect, test } from "@playwright/test";

test.describe.serial("corporate site", () => {
  test.describe("public visitor", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("browses home, services, about and contact", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "What we do" })).toBeVisible();
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Services" })
        .click();
      await expect(page.getByRole("heading", { name: "Services", level: 1 })).toBeVisible();
      await page.goto("/about");
      await expect(page.getByRole("heading", { name: /About/, level: 1 })).toBeVisible();
    });

    test("is ready for search and AI answer engines (JSON-LD, llms.txt, robots, sitemap)", async ({
      page,
      request,
    }) => {
      await page.goto("/");
      await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(3);
      expect(await (await request.get("/llms.txt")).text()).toContain("## Services");
      const robots = await (await request.get("/robots.txt")).text();
      expect(robots).toContain("ClaudeBot");
      expect(robots).toContain("Disallow: /dashboard");
    });

    test("sends a contact message", async ({ page }) => {
      await page.goto("/contact");
      await page.getByLabel("Name").fill("Grace Visitor");
      await page.getByLabel("Email").fill("grace@example.com");
      await page.getByLabel("Message").fill("We would like a quote for a new project.");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByRole("status")).toContainText("Thanks!");
    });
  });

  test("the admin reads the message", async ({ page }) => {
    await page.goto("/dashboard/messages");
    await expect(page.getByText("We would like a quote for a new project.")).toBeVisible();
  });

  test("the admin publishes a post that appears on the blog, RSS and sitemap", async ({
    page,
    request,
  }) => {
    await page.goto("/dashboard/posts");
    await page.getByLabel("Title").fill("Our first article");
    await page.getByLabel("Summary").fill("What we learned in our first year.");
    await page.getByLabel(/Text \(Markdown/).fill("# Hello\n\nThis is **our** first article.");
    await page.getByLabel("Published").check();
    await page.getByRole("button", { name: "Create post" }).click();
    // Wait for the server action to finish (it redirects back to the list) before leaving the page.
    await expect(page.getByRole("cell", { name: "Our first article" })).toBeVisible();
    await page.goto("/blog");
    await page.getByRole("link", { name: "Our first article" }).click();
    await expect(page.getByRole("heading", { name: "Our first article", level: 1 })).toBeVisible();
    expect(await (await request.get("/blog/rss.xml")).text()).toContain("Our first article");
    expect(await (await request.get("/sitemap.xml")).text()).toContain("/blog/our-first-article");
  });

  test("the admin edits the website headline", async ({ page }) => {
    await page.goto("/dashboard/site");
    await page.getByLabel("Headline").fill("We build what you need");
    await page.getByRole("button", { name: "Save texts" }).click();
    await expect(page.getByRole("status")).toContainText("Saved");
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "We build what you need", level: 1 }),
    ).toBeVisible();
  });
});
