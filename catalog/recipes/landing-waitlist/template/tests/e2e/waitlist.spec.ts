import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/** Emails the app recorded (no provider in tests: src/lib/email.ts writes them to EMAIL_OUTBOX_FILE). */
function outbox(): { to: string; subject: string; text?: string }[] {
  const file = process.env.EMAIL_OUTBOX_FILE ?? "";
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { to: string; subject: string; text?: string });
}

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

  test("a visitor joins the waitlist and a confirmation email is sent to their address", async ({
    page,
  }) => {
    const email = `joiner-${Date.now()}@example.com`;
    await page.goto("/");
    await page.getByLabel("Name").fill("Joan Joiner");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(page.getByRole("status")).toContainText("You're on the list");
    await expect
      .poll(() => outbox().filter((m) => m.to === email).length, {
        message: "the confirmation email is sent to the visitor's address",
      })
      .toBe(1);
    const mail = outbox().find((m) => m.to === email);
    expect(mail?.subject, "the email confirms the waitlist sign-up").toContain("waitlist");
    expect(mail?.text, "the email greets the visitor by name").toContain("Joan Joiner");
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

  test("shows the hero with the app's name and tagline, the benefits, how it works and an FAQ", async ({
    page,
  }) => {
    await page.goto("/");
    const hero = page.locator("#join");
    await expect(hero.getByRole("heading", { level: 1 }), "the hero names the app").not.toBeEmpty();
    await expect(
      hero.locator("p").first(),
      "the hero shows the tagline (value proposition)",
    ).not.toBeEmpty();
    const benefits = page.locator('section[aria-labelledby="features"] li');
    expect(await benefits.count(), "the benefits section lists the app's benefits").toBeGreaterThan(
      0,
    );
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    const steps = page.locator('section[aria-labelledby="how"] li');
    expect(await steps.count(), "how it works lists its steps").toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "Frequently asked questions" })).toBeVisible();
    await expect(
      page.locator("details").first(),
      "the FAQ lists questions and answers",
    ).toBeVisible();
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
