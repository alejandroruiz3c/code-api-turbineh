import { graph } from "./graph";
import { providerFetch, ProviderError } from "./http";
import { endpoints, type Network } from "./networks";

/**
 * Engagement metrics of published posts (component social.metrics.turbineh), from each network's official read API:
 *  - LinkedIn: GET /rest/socialMetadata/{post urn} → reactions (all types) and comments. Needs a read scope LinkedIn
 *    grants only to approved apps (r_member_social_feed / r_organization_social_feed); shares and impressions of
 *    member posts are in a separate restricted API and are not fetched (null).
 *  - Facebook Page post: GET /{post-id}?fields=shares,reactions.summary(total_count),comments.summary(total_count).
 *    Impressions are not fetched: post_impressions is deprecated in the Graph API (null).
 *  - Instagram: GET /{media-id}?fields=like_count,comments_count and /{media-id}/insights?metric=views,shares.
 *  - X: GET /2/tweets?ids=…&tweet.fields=public_metrics (likes, replies, reposts + quotes, impressions). Each read is
 *    billed by X (pay-per-use).
 * A value the network did not return stays null (never 0).
 */
export interface Metrics {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  impressions: number | null;
}

type Deps = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch };
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;

export async function fetchMetrics(
  network: Network,
  token: string,
  externalId: string,
  deps: Deps = {},
): Promise<Metrics> {
  const e = endpoints(deps.env);
  if (network === "linkedin") {
    const r = await providerFetch<{
      reactionSummaries?: Record<string, { count?: number }>;
      commentSummary?: { count?: number };
    }>(
      "linkedin",
      `${e.linkedin.api}/rest/socialMetadata/${encodeURIComponent(externalId)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          "linkedin-version": e.linkedin.version,
          "x-restli-protocol-version": "2.0.0",
        },
      },
      deps.fetchImpl,
    );
    const reactions = Object.values(r.body.reactionSummaries ?? {}).map((x) => num(x.count) ?? 0);
    // A post with no activity has no summaries: 0 reactions and 0 comments are then what LinkedIn says.
    return {
      likes: reactions.reduce((a, b) => a + b, 0),
      comments: num(r.body.commentSummary?.count) ?? 0,
      shares: null,
      impressions: null,
    };
  }
  if (network === "facebook") {
    const r = await graph<{
      shares?: { count?: number };
      reactions?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
    }>(
      "GET",
      `/${encodeURIComponent(externalId)}`,
      {
        fields:
          "shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)",
      },
      token,
      { ...deps, network: "facebook" },
    );
    return {
      likes: num(r.body.reactions?.summary?.total_count),
      comments: num(r.body.comments?.summary?.total_count),
      // Meta omits `shares` when nobody shared the post.
      shares: num(r.body.shares?.count) ?? 0,
      impressions: null,
    };
  }
  if (network === "instagram") {
    const opts = { ...deps, network: "instagram" as const };
    const r = await graph<{ like_count?: number; comments_count?: number }>(
      "GET",
      `/${encodeURIComponent(externalId)}`,
      { fields: "like_count,comments_count" },
      token,
      opts,
    );
    let views: number | null = null;
    let shares: number | null = null;
    try {
      const ins = await graph<{ data?: { name: string; values?: { value?: number }[] }[] }>(
        "GET",
        `/${encodeURIComponent(externalId)}/insights`,
        { metric: "views,shares" },
        token,
        opts,
      );
      const value = (name: string) =>
        num(ins.body.data?.find((d) => d.name === name)?.values?.[0]?.value);
      views = value("views");
      shares = value("shares");
    } catch (err) {
      // Insights need instagram_manage_insights; without it likes and comments are still real.
      if (err instanceof ProviderError && err.unauthorized) throw err;
    }
    return {
      likes: num(r.body.like_count),
      comments: num(r.body.comments_count),
      shares,
      impressions: views,
    };
  }
  const r = await providerFetch<{
    data?: { id: string; public_metrics?: Record<string, number> }[];
  }>(
    "x",
    `${e.x.api}/2/tweets?${new URLSearchParams({ ids: externalId, "tweet.fields": "public_metrics" })}`,
    { headers: { authorization: `Bearer ${token}` } },
    deps.fetchImpl,
  );
  const m = r.body.data?.find((d) => d.id === externalId)?.public_metrics;
  if (!m) throw new ProviderError("x", 404, "not_found", "The post was not found (deleted?)");
  const reposts = num(m.retweet_count ?? m.repost_count);
  const quotes = num(m.quote_count);
  return {
    likes: num(m.like_count),
    comments: num(m.reply_count),
    shares: reposts === null && quotes === null ? null : (reposts ?? 0) + (quotes ?? 0),
    impressions: num(m.impression_count),
  };
}
