import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { requireMember } from "@/server/authz";
import { metricsConfig, metricsSince } from "@/social/metrics-config";
import { latestMetrics } from "@/social/metrics";
import { isNetwork, NETWORK_LABEL } from "@/social/networks";

export const dynamic = "force-dynamic";

const show = (v: number | null | undefined) => (v === null || v === undefined ? "—" : String(v));

/** Engagement of published social posts (social.metrics.turbineh): latest likes, comments, shares and impressions. */
export default async function SocialMetricsPage() {
  const ctx = await requireMember();
  const since = metricsSince();
  const rows = await latestMetrics(ctx.organizationId, since);
  const totals = new Map<string, { posts: number; likes: number; comments: number }>();
  for (const r of rows) {
    const t = totals.get(r.network) ?? { posts: 0, likes: 0, comments: 0 };
    t.posts += 1;
    t.likes += r.metrics?.likes ?? 0;
    t.comments += r.metrics?.comments ?? 0;
    totals.set(r.network, t);
  }
  return (
    <div className="flex flex-col gap-6">
      <Card title="Engagement by network">
        <p className="mb-3 text-sm text-muted">
          Posts published in the last {metricsConfig.windowDays} days, refreshed every{" "}
          {metricsConfig.refreshHours} h. “—” means the network does not report that number for this
          post or the app lacks the permission to read it.
        </p>
        <Table head={["Network", "Posts", "Likes", "Comments"]}>
          {[...totals].map(([n, t]) => (
            <tr key={n} className="border-b border-line" data-testid="metrics-total">
              <td className="px-3 py-2">{isNetwork(n) ? NETWORK_LABEL[n] : n}</td>
              <td className="px-3 py-2">{t.posts}</td>
              <td className="px-3 py-2">{t.likes}</td>
              <td className="px-3 py-2">{t.comments}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Published posts">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No published posts in this period.</p>
        ) : (
          <Table
            head={[
              "Published (UTC)",
              "Account",
              "Post",
              "Likes",
              "Comments",
              "Shares",
              "Impressions",
              "Fetched (UTC)",
            ]}
          >
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line" data-testid="metrics-row">
                <td className="px-3 py-2">
                  {r.publishedAt?.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="px-3 py-2">
                  {r.accountName} · {isNetwork(r.network) ? NETWORK_LABEL[r.network] : r.network}
                </td>
                <td className="max-w-xs truncate px-3 py-2">
                  {r.externalUrl ? (
                    <a
                      href={r.externalUrl}
                      className="underline"
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {r.text.slice(0, 80)}
                    </a>
                  ) : (
                    r.text.slice(0, 80)
                  )}
                </td>
                <td className="px-3 py-2">{show(r.metrics?.likes)}</td>
                <td className="px-3 py-2">{show(r.metrics?.comments)}</td>
                <td className="px-3 py-2">{show(r.metrics?.shares)}</td>
                <td className="px-3 py-2">{show(r.metrics?.impressions)}</td>
                <td className="px-3 py-2">
                  {r.metrics
                    ? r.metrics.fetchedAt.toISOString().slice(0, 16).replace("T", " ")
                    : "not yet"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
