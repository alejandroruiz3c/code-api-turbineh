import { expect, test } from "@playwright/test";
import { connectAll, mockRequests, query, runRoute } from "./social-helpers";

/**
 * Engagement metrics end to end (social.metrics.turbineh), offline against the provider mocks: a post published by
 * the runner gets its metrics fetched by the protected metrics route and shown; fresh metrics are not fetched again.
 */
test.use({ timezoneId: "UTC" });

type MetricsReport = {
  fetched: { postId: string; network: string }[];
  failed: unknown[];
  skipped: number;
};

test.describe.serial("social metrics", () => {
  test("the metrics route refuses calls without the secret", async ({ request }) => {
    expect((await request.get("/api/social/metrics/run")).status()).toBe(401);
  });

  test("a dashboard shows likes, comments, shares and impressions of published posts: engagement metrics fetched on a schedule, not fetched again while fresh", async ({
    page,
    request,
  }) => {
    await connectAll(page);
    const text = `Metrics check ${Date.now()}`;
    await page.goto("/dashboard/social/posts");
    await page.getByRole("checkbox", { name: /· X$/ }).check();
    await page.getByLabel("Text", { exact: true }).fill(text);
    await page.getByLabel("Publish at").fill(new Date().toISOString().slice(0, 16));
    await page.getByRole("button", { name: /Submit for approval|Schedule/ }).click();
    await expect(page.getByRole("status")).toContainText("1 post(s)");
    await page.reload();
    const item = page.getByTestId("social-post").filter({ hasText: text });
    if (await item.getByRole("button", { name: "Approve" }).count())
      await item.getByRole("button", { name: "Approve" }).click();
    await expect(item.getByTestId("post-status")).toHaveText("Scheduled");
    await runRoute(request, "/api/social/publish/run");
    const [post] = await query<{ id: string; status: string }>(
      "select id, status from social_posts where text = $1",
      [text],
    );
    expect(post?.status).toBe("published");

    const first = await runRoute<MetricsReport>(request, "/api/social/metrics/run");
    expect(first.fetched.map((f) => f.postId)).toContain(post?.id);
    const [m] = await query<{
      likes: number;
      comments: number;
      shares: number;
      impressions: number;
    }>("select likes, comments, shares, impressions from social_post_metrics where post_id = $1", [
      post?.id,
    ]);
    expect(m).toEqual({ likes: 15, comments: 2, shares: 4, impressions: 512 });
    const xReads = (await mockRequests(request, "X_API_BASE")).filter(
      (r) => r.method === "GET" && r.path === "/2/tweets",
    );
    expect(xReads.at(-1)?.query["tweet.fields"]).toBe("public_metrics");

    await page.goto("/dashboard/social/metrics");
    const row = page.getByTestId("metrics-row").filter({ hasText: text });
    await expect(row.locator("td").nth(3)).toHaveText("15");
    await expect(row.locator("td").nth(4)).toHaveText("2");
    await expect(row.locator("td").nth(5)).toHaveText("4");
    await expect(row.locator("td").nth(6)).toHaveText("512");
    await expect(page.getByTestId("metrics-total").filter({ hasText: "X" })).toBeVisible();

    // Fresh metrics are not fetched again before refreshHours.
    const second = await runRoute<MetricsReport>(request, "/api/social/metrics/run");
    expect(second.fetched.map((f) => f.postId)).not.toContain(post?.id);
  });

  test("a metric a network does not report stays empty instead of 0 (LinkedIn impressions)", async ({
    page,
    request,
  }) => {
    await connectAll(page);
    const text = `LinkedIn metrics ${Date.now()}`;
    await page.goto("/dashboard/social/posts");
    await page.getByRole("checkbox", { name: /Ada Lovelace · LinkedIn/ }).check();
    await page.getByLabel("Text", { exact: true }).fill(text);
    await page.getByLabel("Publish at").fill(new Date().toISOString().slice(0, 16));
    await page.getByRole("button", { name: /Submit for approval|Schedule/ }).click();
    await expect(page.getByRole("status")).toContainText("1 post(s)");
    await page.reload();
    const item = page.getByTestId("social-post").filter({ hasText: text });
    if (await item.getByRole("button", { name: "Approve" }).count())
      await item.getByRole("button", { name: "Approve" }).click();
    await expect(item.getByTestId("post-status")).toHaveText("Scheduled");
    await runRoute(request, "/api/social/publish/run");
    await runRoute(request, "/api/social/metrics/run");
    await page.goto("/dashboard/social/metrics");
    const row = page.getByTestId("metrics-row").filter({ hasText: text });
    await expect(row.locator("td").nth(3)).toHaveText("15");
    await expect(row.locator("td").nth(6)).toHaveText("—");
  });
});
