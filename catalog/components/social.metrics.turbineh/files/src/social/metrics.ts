import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { socialConnections, socialPostMetrics, socialPosts } from "@/db/schema";
import { accessTokenFor, markExpired } from "./connections";
import { ProviderError } from "./http";
import { metricsConfig } from "./metrics-config";
import { fetchMetrics } from "./metrics-api";
import type { Network } from "./networks";

/** Scheduled fetch of engagement metrics (component social.metrics.turbineh); the per-network calls are in metrics-api.ts. */

export interface MetricsReport {
  fetched: { postId: string; network: string }[];
  failed: { postId: string; network: string; error: string }[];
  skipped: number;
}

/**
 * Fetches metrics for posts published in the last `windowDays` whose latest snapshot is older than `refreshHours`
 * (called by the protected route on a schedule). One snapshot row per post and fetch.
 */
export async function runMetrics(
  opts: {
    now?: Date;
    limit?: number;
    deps?: Parameters<typeof fetchMetrics>[3];
    config?: typeof metricsConfig;
  } = {},
): Promise<MetricsReport> {
  const now = opts.now ?? new Date();
  const cfg = opts.config ?? metricsConfig;
  const report: MetricsReport = { fetched: [], failed: [], skipped: 0 };
  const since = new Date(now.getTime() - cfg.windowDays * 86_400_000);
  const posts = await db
    .select({
      id: socialPosts.id,
      organizationId: socialPosts.organizationId,
      connectionId: socialPosts.connectionId,
      network: socialPosts.network,
      externalId: socialPosts.externalId,
    })
    .from(socialPosts)
    .innerJoin(socialConnections, eq(socialConnections.id, socialPosts.connectionId))
    .where(
      and(
        eq(socialPosts.status, "published"),
        gte(socialPosts.publishedAt, since),
        eq(socialConnections.status, "active"),
      ),
    )
    .orderBy(desc(socialPosts.publishedAt))
    .limit(500);
  if (posts.length === 0) return report;
  const latest = await db
    .select({ postId: socialPostMetrics.postId, fetchedAt: socialPostMetrics.fetchedAt })
    .from(socialPostMetrics)
    .where(
      inArray(
        socialPostMetrics.postId,
        posts.map((p) => p.id),
      ),
    )
    .orderBy(desc(socialPostMetrics.fetchedAt));
  const last = new Map<string, Date>();
  for (const l of latest) if (!last.has(l.postId)) last.set(l.postId, l.fetchedAt);
  const fresh = (id: string) => {
    const at = last.get(id);
    return at !== undefined && now.getTime() - at.getTime() < cfg.refreshHours * 3_600_000;
  };
  let done = 0;
  for (const p of posts) {
    if (!p.externalId || fresh(p.id) || done >= (opts.limit ?? 50)) {
      report.skipped += 1;
      continue;
    }
    done += 1;
    try {
      const { token } = await accessTokenFor(p.organizationId, p.connectionId, now);
      const m = await fetchMetrics(p.network as Network, token, p.externalId, opts.deps);
      await db
        .insert(socialPostMetrics)
        .values({
          organizationId: p.organizationId,
          postId: p.id,
          network: p.network,
          ...m,
          fetchedAt: now,
        })
        .onConflictDoNothing();
      report.fetched.push({ postId: p.id, network: p.network });
    } catch (err) {
      const e = err instanceof ProviderError ? err : null;
      if (e?.unauthorized && e.code !== "expired")
        await markExpired(p.organizationId, p.connectionId, `Token refused (${e.summary})`);
      report.failed.push({
        postId: p.id,
        network: p.network,
        error: e ? e.summary : err instanceof Error ? err.name : "error",
      });
    }
  }
  return report;
}

/** Latest snapshot of each published post of a workspace (for the metrics page). */
export async function latestMetrics(organizationId: string, since: Date) {
  const posts = await db
    .select({
      id: socialPosts.id,
      network: socialPosts.network,
      text: socialPosts.text,
      publishedAt: socialPosts.publishedAt,
      externalUrl: socialPosts.externalUrl,
      accountName: socialConnections.accountName,
    })
    .from(socialPosts)
    .innerJoin(socialConnections, eq(socialConnections.id, socialPosts.connectionId))
    .where(
      and(
        eq(socialPosts.organizationId, organizationId),
        eq(socialPosts.status, "published"),
        gte(socialPosts.publishedAt, since),
      ),
    )
    .orderBy(desc(socialPosts.publishedAt));
  if (posts.length === 0) return [];
  const snaps = await db
    .select()
    .from(socialPostMetrics)
    .where(
      and(
        eq(socialPostMetrics.organizationId, organizationId),
        inArray(
          socialPostMetrics.postId,
          posts.map((p) => p.id),
        ),
      ),
    )
    .orderBy(desc(socialPostMetrics.fetchedAt));
  return posts.map((p) => ({ ...p, metrics: snaps.find((s) => s.postId === p.id) ?? null }));
}
