// Server-only code in the app: engagement of one published post (the hourly job at /api/social/metrics/run does this
// for every recent post).
import { accessTokenFor, type Ctx } from "@/social/connections";
import { fetchMetrics } from "@/social/metrics-api";

export async function postMetrics(ctx: Ctx, connectionId: string, externalId: string) {
  const { token, network } = await accessTokenFor(ctx.organizationId, connectionId);
  const m = await fetchMetrics(network, token, externalId);
  return { likes: m.likes, comments: m.comments, shares: m.shares, impressions: m.impressions };
}
