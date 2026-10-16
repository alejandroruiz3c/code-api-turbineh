import { expect, test, type Page } from "@playwright/test";
import { connectAll, failNext, mockRequests, query, runRoute } from "./social-helpers";

/**
 * Social publishing end to end (social.publish.turbineh), offline against the LinkedIn, Meta Graph and X mocks:
 * compose with per-network rules, approval, scheduled publication by the protected runner, retries, idempotency and
 * the append-only publication log. The browser runs in UTC so typed times are UTC.
 */
test.use({ timezoneId: "UTC" });

type Report = {
  published: { id: string; network: string; externalId: string }[];
  retrying: { id: string; network: string }[];
  failed: { id: string; network: string; error: string }[];
  unknown: unknown[];
};
const now = () => new Date().toISOString().slice(0, 16);

async function compose(
  page: Page,
  accounts: RegExp[],
  text: string,
  opts: { image?: string; versions?: Record<string, string> } = {},
) {
  await page.goto("/dashboard/social/posts");
  for (const a of accounts) await page.getByRole("checkbox", { name: a }).check();
  await page.getByLabel("Text", { exact: true }).fill(text);
  for (const [label, v] of Object.entries(opts.versions ?? {}))
    await page.getByLabel(`${label} version (optional)`).fill(v);
  if (opts.image) await page.getByLabel(/Image URL/).fill(opts.image);
  await page.getByLabel("Publish at").fill(now());
}

const post = (page: Page, text: string) =>
  page.getByTestId("social-post").filter({ hasText: text });

test.describe.serial("social publishing", () => {
  test.beforeEach(async ({ page }) => {
    await connectAll(page);
  });

  test("the runner route refuses calls without the secret", async ({ request }) => {
    expect((await request.post("/api/social/publish/run")).status()).toBe(401);
    expect(
      (
        await request.post("/api/social/publish/run", {
          headers: { "x-cron-secret": "x".repeat(64) },
        })
      ).status(),
    ).toBe(401);
  });

  test("each post is adapted to each network's format and length before it is saved: a text over X's 280 weighted characters is refused with its count and nothing is saved, a shorter X version is saved", async ({
    page,
  }) => {
    const text = `Too long ${Date.now()} ${"a".repeat(280)}`;
    await compose(page, [/· X$/], text);
    await expect(page.getByTestId("count-x")).toContainText(/X: \d+\/280/);
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.locator(`p[role="alert"]`)).toContainText(/X: \d+\/280 characters/);
    expect(await query("select id from social_posts where text = $1", [text])).toEqual([]);
    await page.getByLabel("X version (optional)").fill(`Short for X ${Date.now()}`);
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByRole("status")).toContainText("1 post(s) sent for approval");
  });

  test("human approval before publishing: the owner approves each post before it is published; approved posts are published automatically at the scheduled time by the runner, once, and every step is logged", async ({
    page,
    request,
  }) => {
    const text = `Fresh sourdough today (${Date.now()}) #Bakery`;
    await compose(page, [/Ada Lovelace · LinkedIn/, /· X$/], text);
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByRole("status")).toContainText("2 post(s) sent for approval");
    await page.reload();
    await expect(post(page, text)).toHaveCount(2);
    for (const item of await post(page, text).all())
      await expect(item.getByTestId("post-status")).toHaveText("Waiting for approval");

    // Not approved yet: the runner publishes nothing of it.
    const before = await runRoute<Report>(request, "/api/social/publish/run");
    const ids = (
      await query<{ id: string }>("select id from social_posts where text = $1", [text])
    ).map((r) => r.id);
    expect(before.published.filter((p) => ids.includes(p.id))).toEqual([]);

    for (let i = 0; i < 2; i++) {
      await post(page, text)
        .filter({ has: page.getByRole("button", { name: "Approve" }) })
        .first()
        .getByRole("button", { name: "Approve" })
        .click();
      await expect(
        post(page, text).getByTestId("post-status").filter({ hasText: "Scheduled" }),
      ).toHaveCount(i + 1);
    }
    const run = await runRoute<Report>(request, "/api/social/publish/run");
    expect(
      run.published
        .filter((p) => ids.includes(p.id))
        .map((p) => p.network)
        .sort(),
    ).toEqual(["linkedin", "x"]);
    await page.reload();
    for (const item of await post(page, text).all())
      await expect(item.getByTestId("post-status")).toHaveText("Published");

    // The networks received the documented requests.
    const li = (await mockRequests(request, "LINKEDIN_API_BASE"))
      .filter((r) => r.path === "/rest/posts")
      .map((r) => JSON.parse(r.body));
    expect(
      li.some(
        (b) =>
          b.commentary ===
          `Fresh sourdough today \\(${text.match(/\((\d+)\)/)?.[1]}\\) {hashtag|\\#|Bakery}`,
      ),
    ).toBe(true);
    const xs = (await mockRequests(request, "X_API_BASE"))
      .filter((r) => r.method === "POST" && r.path === "/2/tweets")
      .map((r) => JSON.parse(r.body));
    expect(xs.filter((b) => b.text === text)).toHaveLength(1);

    // Running again publishes nothing twice.
    const again = await runRoute<Report>(request, "/api/social/publish/run");
    expect(again.published.filter((p) => ids.includes(p.id))).toEqual([]);
    const xsAfter = (await mockRequests(request, "X_API_BASE"))
      .filter((r) => r.method === "POST" && r.path === "/2/tweets")
      .map((r) => JSON.parse(r.body));
    expect(xsAfter.filter((b) => b.text === text)).toHaveLength(1);

    // The log of each post: created → approved → attempt → published.
    await post(page, text).first().getByRole("link", { name: "Details and log" }).click();
    await expect(page).toHaveURL(/\/dashboard\/social\/posts\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("post-status")).toHaveText("Published");
    const events = await page.getByTestId("log-entry").locator("td:nth-child(2)").allTextContents();
    expect(events.reverse()).toEqual(["created", "approved", "attempt", "published"]);
  });

  test("a failed publication is retried with backoff and then published; each attempt is in the publication log", async ({
    page,
    request,
  }) => {
    const text = `Open on Sunday ${Date.now()}`;
    await compose(page, [/Sunny Bakery · Facebook Page/], text);
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByRole("status")).toContainText("1 post(s) sent for approval");
    await page.reload();
    await post(page, text).getByRole("button", { name: "Approve" }).click();
    await expect(post(page, text).getByTestId("post-status")).toHaveText("Scheduled");
    await failNext(request, "META_GRAPH_API_BASE", "POST /v26.0/page-1/feed", 503);
    const first = await runRoute<Report>(request, "/api/social/publish/run");
    const [row] = await query<{ id: string; status: string; attempts: number; wait: number }>(
      "select id, status, attempts, extract(epoch from next_attempt_at - now()) as wait from social_posts where text = $1",
      [text],
    );
    expect(first.retrying.map((r) => r.id)).toContain(row?.id);
    expect(row?.status).toBe("retrying");
    expect(Number(row?.wait)).toBeGreaterThan(20); // backoff: not retried at once
    // Time passes: the next attempt is due.
    await query(
      "update social_posts set next_attempt_at = now() - interval '1 second' where id = $1",
      [row?.id],
    );
    const second = await runRoute<Report>(request, "/api/social/publish/run");
    expect(second.published.map((p) => p.id)).toContain(row?.id);
    const log = await query<{ event: string; attempt: number; http_status: number | null }>(
      "select event, attempt, http_status from social_publication_log where post_id = $1 order by at, attempt",
      [row?.id],
    );
    expect(log.map((l) => [l.event, l.attempt, l.http_status])).toEqual([
      ["created", 0, null],
      ["approved", 0, null],
      ["attempt", 1, null],
      ["retry", 1, 503],
      ["attempt", 2, null],
      ["published", 2, null],
    ]);
  });

  test("an Instagram post needs an image; with one it is published through a media container", async ({
    page,
    request,
  }) => {
    const text = `Croissants ${Date.now()}`;
    await compose(page, [/@sunnybakery · Instagram/], text);
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.locator(`p[role="alert"]`)).toContainText("Instagram: an image is required");
    await page.getByLabel(/Image URL/).fill("https://cdn.example.com/croissants.jpg");
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByRole("status")).toContainText("1 post(s) sent for approval");
    await page.reload();
    await post(page, text).getByRole("button", { name: "Approve" }).click();
    await expect(post(page, text).getByTestId("post-status")).toHaveText("Scheduled");
    const run = await runRoute<Report>(request, "/api/social/publish/run");
    expect(run.published.some((p) => p.network === "instagram")).toBe(true);
    const meta = await mockRequests(request, "META_GRAPH_API_BASE");
    expect(
      meta.some(
        (r) =>
          r.path === "/v26.0/ig-1/media" && new URLSearchParams(r.body).get("caption") === text,
      ),
    ).toBe(true);
    expect(meta.some((r) => r.path === "/v26.0/ig-1/media_publish")).toBe(true);
  });

  test("an X access token about to expire is refreshed before publishing (the rotated refresh token is stored encrypted)", async ({
    page,
    request,
  }) => {
    await query(
      "update social_connections set access_expires_at = now() + interval '1 minute' where network = 'x' and status = 'active'",
    );
    const [before] = await query<{ refresh: string }>(
      "select refresh_token_sealed as refresh from social_connections where network = 'x' and status = 'active'",
    );
    const text = `Refreshed ${Date.now()}`;
    await compose(page, [/· X$/], text);
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByRole("status")).toContainText("1 post(s) sent for approval");
    await page.reload();
    await post(page, text).getByRole("button", { name: "Approve" }).click();
    await expect(post(page, text).getByTestId("post-status")).toHaveText("Scheduled");
    const run = await runRoute<Report>(request, "/api/social/publish/run");
    expect(run.published.some((p) => p.network === "x")).toBe(true);
    const refreshes = (await mockRequests(request, "X_API_BASE")).filter(
      (r) =>
        r.path === "/2/oauth2/token" &&
        new URLSearchParams(r.body).get("grant_type") === "refresh_token",
    );
    expect(refreshes.length).toBeGreaterThanOrEqual(1);
    const [after] = await query<{ refresh: string; wait: number }>(
      "select refresh_token_sealed as refresh, extract(epoch from access_expires_at - now()) as wait from social_connections where network = 'x' and status = 'active'",
    );
    expect(after?.refresh).toMatch(/^v1\./);
    expect(after?.refresh).not.toBe(before?.refresh);
    expect(Number(after?.wait)).toBeGreaterThan(3600);
  });

  test("each post has a unique idempotency key and the publication log is append-only in the database", async () => {
    const [p] = await query<{
      organization_id: string;
      connection_id: string;
      idempotency_key: string;
    }>("select organization_id, connection_id, idempotency_key from social_posts limit 1");
    await expect(
      query(
        "insert into social_posts (organization_id, connection_id, network, idempotency_key, text, scheduled_at, created_by) values ($1, $2, 'x', $3, 'dup', now(), 'u')",
        [p?.organization_id, p?.connection_id, p?.idempotency_key],
      ),
    ).rejects.toThrow(/duplicate key|unique/);
    await expect(query("update social_publication_log set detail = 'changed'")).rejects.toThrow(
      /append-only/,
    );
    await expect(query("delete from social_publication_log")).rejects.toThrow(/append-only/);
  });

  test("a content calendar shows the scheduled and published posts on their day with their network and status", async ({
    page,
  }) => {
    await page.goto("/dashboard/social/posts");
    const today = new Date().toISOString().slice(0, 10);
    const cell = page.locator(`[data-day="${today}"]`);
    await expect(cell.getByRole("link", { name: /LinkedIn · Published/ }).first()).toBeVisible();
    await expect(cell.getByRole("link", { name: /X · Published/ }).first()).toBeVisible();
  });
});
