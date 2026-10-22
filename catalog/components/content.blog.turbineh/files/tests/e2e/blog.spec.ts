import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * The blog end to end (component content.blog.turbineh): staff write Markdown posts with frontmatter in the editor,
 * drafts stay private, visitors read published posts (list, post page, tags, authors, search), RSS and sitemap. Every
 * title is unique to this run so the suite can run against a database that already has posts.
 */
const params = JSON.parse(readFileSync("src/blog/params.json", "utf8")) as {
  postsPerPage: number;
  wordsPerMinute: number;
  feedItems: number;
};
const run = Date.now().toString(36);
const anonymous = { storageState: { cookies: [], origins: [] } };

/** Writes a post in the editor; `frontmatter` goes on top of the Markdown. Returns after the list shows it. */
async function writePost(
  page: Page,
  opts: { title: string; body: string; frontmatter?: string; publish?: boolean },
) {
  await page.goto("/dashboard/blog/edit");
  await page.getByLabel("Title").fill(opts.frontmatter ? "" : opts.title);
  await page
    .getByLabel(/^Text \(Markdown/)
    .fill(`${opts.frontmatter ? `---\n${opts.frontmatter}\n---\n\n` : ""}${opts.body}`);
  await page
    .getByRole("button", { name: opts.publish === false ? "Save draft" : "Publish" })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/blog$/);
  await expect(page.getByTestId("blog-row").filter({ hasText: opts.title }).first()).toBeVisible();
}

const row = (page: Page, title: string) => page.getByTestId("blog-row").filter({ hasText: title });

test.describe.serial("blog", () => {
  const author = `Ada Writer ${run}`;
  const authorSlug = `ada-writer-${run}`;
  const tag = `research-${run}`;

  test("the admin writes a post in Markdown with frontmatter (title, author, tags, excerpt), saves it as a draft that stays private — not on the blog, the RSS feed or the sitemap — then publishes it", async ({
    page,
    request,
  }) => {
    await page.goto("/dashboard/blog/authors");
    await page.getByLabel("Name").fill(author);
    await page.getByLabel("Bio").fill("Writes about attention and transformers.");
    await page.getByRole("button", { name: "Add author" }).click();
    await expect(page.getByRole("cell", { name: author })).toBeVisible();

    const title = `Attention explained ${run}`;
    await writePost(page, {
      title,
      publish: false,
      frontmatter: `title: ${title}\nauthor: ${author}\ntags: [${tag}, transformers]\nexcerpt: How attention weighs every token.`,
      body: "# Why attention\n\nEach token looks at **every** other token. <script>alert(1)</script>",
    });
    await expect(row(page, title)).toContainText("Draft");
    const slug = `attention-explained-${run}`;
    expect((await request.get(`/blog/${slug}`)).status()).toBe(404);
    expect(await (await request.get("/blog")).text()).not.toContain(title);
    expect(await (await request.get("/blog/rss.xml")).text()).not.toContain(title);
    expect(await (await request.get("/blog/sitemap.xml")).text()).not.toContain(slug);

    await row(page, title).getByRole("button", { name: "Publish" }).click();
    await expect(row(page, title)).toContainText("Published");
    expect((await request.get(`/blog/${slug}`)).status()).toBe(200);
    expect(await (await request.get("/blog")).text()).toContain(title);
  });

  test.describe("visitors", () => {
    test.use(anonymous);

    test("a visitor reads a post with its author, date, reading time and tags; the Markdown is rendered without raw HTML and the page has Article JSON-LD and OpenGraph metadata", async ({
      page,
    }) => {
      await page.goto(`/blog/attention-explained-${run}`);
      await expect(
        page.getByRole("heading", { name: `Attention explained ${run}`, level: 1 }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: author }).first()).toBeVisible();
      await expect(page.getByText("1 min read")).toBeVisible();
      await expect(page.getByRole("link", { name: `#${tag}` })).toBeVisible();
      await expect(page.locator("time").first()).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
      await expect(page.getByRole("heading", { name: "Why attention" })).toBeVisible();
      await expect(page.locator("strong", { hasText: "every" })).toBeVisible();
      await expect(page.getByText("<script>alert(1)</script>")).toBeVisible();
      const ld = JSON.parse(
        (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}",
      ) as Record<string, unknown>;
      expect(ld["@type"]).toBe("BlogPosting");
      expect(ld.headline).toBe(`Attention explained ${run}`);
      expect((ld.author as { name: string }).name).toBe(author);
      await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        "content",
        `Attention explained ${run}`,
      );
    });

    test("an unknown or draft post is not found", async ({ request }) => {
      expect((await request.get(`/blog/no-such-post-${run}`)).status()).toBe(404);
      expect((await request.get("/blog/..%2F..%2Fetc")).status()).toBe(404);
    });
  });

  test("a visitor sees the published posts newest first, paginated, each with its author, date, reading time and tags", async ({
    page,
    browser,
  }) => {
    const n = params.postsPerPage + 1;
    for (let i = 1; i <= n; i++)
      await writePost(page, {
        title: `Paging ${run} number ${i}`,
        frontmatter: `title: Paging ${run} number ${i}\nauthor: ${author}\ntags: [paging-${run}]`,
        body: `Paging post ${i} of this run, long enough to read.`,
      });
    const visitor = await (await browser.newContext(anonymous)).newPage();
    await visitor.goto("/blog");
    const first = visitor.getByTestId("blog-post").first();
    await expect(first).toContainText(`Paging ${run} number ${n}`);
    await expect(first).toContainText(author);
    await expect(first).toContainText("min read");
    await expect(first).toContainText(`#paging-${run}`);
    await expect(first.locator("time")).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
    await visitor.goto(`/blog?q=${encodeURIComponent(`Paging ${run}`)}`);
    await expect(visitor.getByTestId("blog-post")).toHaveCount(params.postsPerPage);
    await expect(visitor.getByTestId("blog-post").first()).toContainText(`number ${n}`);
    await visitor.getByRole("link", { name: "Older" }).click();
    await expect(visitor.getByTestId("blog-post")).toHaveCount(1);
    await expect(visitor.getByTestId("blog-post")).toContainText(`Paging ${run} number 1`);
  });

  test.describe("visitors browse", () => {
    test.use(anonymous);

    test("a visitor opens a tag and sees only the posts with that tag", async ({ page }) => {
      await page.goto(`/blog/attention-explained-${run}`);
      await page.getByRole("link", { name: `#${tag}` }).click();
      await expect(page).toHaveURL(new RegExp(`/blog/tag/${tag}$`));
      await expect(page.getByRole("heading", { level: 1 })).toContainText(`#${tag}`);
      await expect(page.getByTestId("blog-post")).toHaveCount(1);
      await expect(page.getByTestId("blog-post")).toContainText(`Attention explained ${run}`);
    });

    test("a visitor opens an author page with the author's bio and only that author's posts", async ({
      page,
    }) => {
      await page.goto(`/blog/author/${authorSlug}`);
      await expect(page.getByRole("heading", { name: author, level: 1 })).toBeVisible();
      await expect(page.getByText("Writes about attention and transformers.")).toBeVisible();
      const posts = page.getByTestId("blog-post");
      await expect(posts.first()).toBeVisible();
      for (const text of await posts.allTextContents()) expect(text).toContain(author);
      // Newest first: this run's latest post leads; the older one is on the next page.
      await expect(posts.first()).toContainText(`Paging ${run} number ${params.postsPerPage + 1}`);
      await page.goto(`/blog/author/${authorSlug}?page=2`);
      await expect(page.getByRole("link", { name: `Attention explained ${run}` })).toBeVisible();
    });

    test("a visitor searches posts by keyword and sees only the matching posts", async ({
      page,
    }) => {
      await page.goto("/blog");
      await page
        .getByRole("searchbox", { name: "Search posts" })
        .fill(`Attention explained ${run}`);
      await page.getByRole("button", { name: "Search" }).click();
      await expect(page.getByRole("status")).toContainText("1 result");
      await expect(page.getByTestId("blog-post")).toHaveCount(1);
      await expect(page.getByTestId("blog-post")).toContainText(`Attention explained ${run}`);
      await page.goto(`/blog?q=${encodeURIComponent(`nothing-matches-${run}%`)}`);
      await expect(page.getByTestId("blog-post")).toHaveCount(0);
    });

    test("the RSS feed lists the published posts newest first with escaped titles, author and tags", async ({
      request,
    }) => {
      const res = await request.get("/blog/rss.xml");
      expect(res.headers()["content-type"]).toContain("application/rss+xml");
      const feed = await res.text();
      expect(feed).toContain('<rss version="2.0"');
      expect(feed.match(/<item>/g)?.length ?? 0).toBeLessThanOrEqual(params.feedItems);
      const newest = feed.indexOf(`Paging ${run} number ${params.postsPerPage + 1}`);
      const older = feed.indexOf(`Paging ${run} number ${params.postsPerPage}<`);
      expect(newest).toBeGreaterThan(0);
      expect(older === -1 || older > newest).toBe(true);
      expect(feed).toContain(`<dc:creator>${author}</dc:creator>`);
      expect(feed).toContain(`<category>paging-${run}</category>`);
    });

    test("the blog sitemap lists the published posts, their tag pages and author pages", async ({
      request,
    }) => {
      const map = await (await request.get("/blog/sitemap.xml")).text();
      expect(map).toContain(`/blog/attention-explained-${run}`);
      expect(map).toContain(`/blog/tag/${tag}`);
      expect(map).toContain(`/blog/author/${authorSlug}`);
    });

    test("people who are not staff cannot open the blog editor", async ({ page }) => {
      await page.goto("/dashboard/blog");
      await expect(page).toHaveURL(/\/sign-in/);
    });
  });

  test("the admin unpublishes and deletes posts: they disappear from the blog, the RSS feed and the sitemap", async ({
    page,
    request,
  }) => {
    const title = `Attention explained ${run}`;
    await page.goto("/dashboard/blog");
    await row(page, title).getByRole("button", { name: "Unpublish" }).click();
    await expect(row(page, title)).toContainText("Draft");
    const slug = `attention-explained-${run}`;
    expect((await request.get(`/blog/${slug}`)).status()).toBe(404);
    expect(await (await request.get("/blog/rss.xml")).text()).not.toContain(title);
    expect(await (await request.get("/blog/sitemap.xml")).text()).not.toContain(slug);
    await row(page, title).getByRole("button", { name: "Delete" }).click();
    await expect(row(page, title)).toHaveCount(0);
  });
});
