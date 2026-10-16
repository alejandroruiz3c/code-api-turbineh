import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Public pages end to end (component site.public-pages.turbineh): staff publish entries of a collection (e.g.
 * portfolio projects), visitors browse and filter them, open a page per entry with SEO metadata and an Open Graph
 * image, and drafts never show. The collection and its filter come from this app's src/site-pages/params.json.
 */
type Params = { pages: { entity: string; path: string; detail: boolean; filters: string[] }[] };
const params = JSON.parse(readFileSync("src/site-pages/params.json", "utf8")) as Params;
const page0 = params.pages.find((p) => p.detail) ?? params.pages[0]!;
const key = page0.path.slice(1);
const filter = page0.filters
  .map((f) => f.trim().toLowerCase())
  .find((f) => /^[a-z][a-z0-9]*( [a-z0-9]+)?$/.test(f));
const filterLabel = filter ? filter.charAt(0).toUpperCase() + filter.slice(1) : null;
// The field is located by its id (the key config.ts derives), not its label: a filter named like a form field
// ("title", "summary", "order", "text"…) would make the label ambiguous.
const filterKey = filter ? filter.replace(/ /g, "_") : null;
const stamp = Date.now();
const A = { title: `Bridge ${stamp}`, value: "Bridges" };
const B = { title: `Tower ${stamp}`, value: "Towers" };
const DRAFT = `Draft ${stamp}`;
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-");

async function addEntry(page: Page, title: string, value: string | null, published: boolean) {
  await page.goto(`/dashboard/site-pages/${key}`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Summary").fill(`${title} summary`);
  if (filterKey && value) await page.locator(`#se-${filterKey}`).fill(value);
  if (published) await page.getByLabel("Published").check();
  await page.getByRole("button", { name: /^Add / }).click();
  await expect(page.getByTestId("site-entry-row").filter({ hasText: title })).toContainText(
    published ? "Published" : "Draft",
  );
}

test.describe.serial("public pages", () => {
  test("staff publish entries and visitors browse the list, filtered by its field", async ({
    page,
    browser,
  }) => {
    await addEntry(page, A.title, A.value, true);
    await addEntry(page, B.title, B.value, true);
    const visitor = await (
      await browser.newContext({ storageState: { cookies: [], origins: [] } })
    ).newPage();
    await visitor.goto(page0.path);
    await expect(visitor.getByTestId("entry").filter({ hasText: A.title })).toBeVisible();
    await expect(visitor.getByTestId("entry").filter({ hasText: B.title })).toBeVisible();
    if (filterKey) {
      await expect(visitor.locator(`label[for="f-${filterKey}"]`)).toHaveText(filterLabel!);
      await visitor.locator(`#f-${filterKey}`).selectOption(A.value);
      await visitor.getByRole("button", { name: "Filter" }).click();
      await expect(visitor.getByTestId("entry").filter({ hasText: A.title })).toBeVisible();
      await expect(visitor.getByTestId("entry").filter({ hasText: B.title })).toHaveCount(0);
    }
    await visitor.context().close();
  });

  test("each entry has its own page with title, description, canonical URL and an Open Graph image", async ({
    browser,
  }) => {
    test.skip(!page0.detail, "this collection has no page per entry");
    const visitor = await (
      await browser.newContext({ storageState: { cookies: [], origins: [] } })
    ).newPage();
    await visitor.goto(`${page0.path}/${slug(A.title)}`);
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(A.title);
    await expect(visitor.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      `${A.title} summary`,
    );
    await expect(visitor.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${page0.path}/${slug(A.title)}$`),
    );
    await expect(visitor.locator('meta[property="og:title"]')).toHaveAttribute("content", A.title);
    const og = await visitor.locator('meta[property="og:image"]').first().getAttribute("content");
    expect(og).toBeTruthy();
    const image = await visitor.request.get(new URL(og!).pathname + new URL(og!).search);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
    await visitor.context().close();
  });

  test("drafts are never shown to visitors, and the sitemap lists only published pages", async ({
    page,
    request,
  }) => {
    await addEntry(page, DRAFT, null, false);
    const visitor = await request.get(page0.path);
    expect(await visitor.text()).not.toContain(DRAFT);
    expect((await request.get(`${page0.path}/${slug(DRAFT)}`)).status()).toBe(404);
    const sitemap = await request.get("/sitemap.xml");
    test.skip(sitemap.status() !== 200, "this app has no sitemap");
    const xml = await sitemap.text();
    expect(xml).toContain(`${page0.path}/${slug(A.title)}`);
    expect(xml).not.toContain(slug(DRAFT));
    expect(xml).not.toContain("/dashboard");
  });
});
