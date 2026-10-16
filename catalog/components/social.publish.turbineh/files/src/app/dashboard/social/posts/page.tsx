import { randomBytes } from "node:crypto";
import Link from "next/link";
import { Composer } from "@/components/social/composer";
import { PostButtons, STATUS_LABEL } from "@/components/social/post-buttons";
import { Card } from "@/components/ui/card";
import { formatDateTime, toDateTimeInput } from "@/lib/datetime";
import { can, requireMember } from "@/server/authz";
import { listConnections } from "@/social/connections";
import { isNetwork, NETWORK_LABEL } from "@/social/networks";
import { listPosts } from "@/social/posts";
import { publishConfig } from "@/social/publish-config";

export const dynamic = "force-dynamic";

const monthOf = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 7);

/** Social posts (social.publish.turbineh): composer, month calendar and the list of posts with their actions. */
export default async function SocialPostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireMember();
  const q = await searchParams;
  const month = monthOf(q.month);
  const [y, m] = month.split("-").map(Number) as [number, number];
  // A margin of a day on each side: posts are placed on the day of the zone they were scheduled in.
  const from = new Date(Date.UTC(y, m - 1, 1) - 86_400_000);
  const to = new Date(Date.UTC(y, m, 1) + 86_400_000);
  const [connections, posts] = await Promise.all([
    listConnections(ctx.organizationId),
    listPosts(ctx.organizationId, from, to),
  ]);
  const accounts = connections
    .filter(
      (c) =>
        c.status === "active" && isNetwork(c.network) && publishConfig.networks.includes(c.network),
    )
    .map((c) => ({
      id: c.id,
      network: c.network as never,
      label: `${c.accountName} · ${isNetwork(c.network) ? NETWORK_LABEL[c.network] : c.network}`,
    }));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const dayOf = (p: (typeof posts)[number]) =>
    toDateTimeInput(p.scheduledAt, p.scheduledTimeZone).slice(0, 10);
  const shift = (d: number) => {
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    return t.toISOString().slice(0, 7);
  };
  const error = typeof q.error === "string" ? q.error.slice(0, 300) : null;
  const approver = can(ctx.role, "approve");
  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="rounded-md border border-line bg-subtle p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Card title="New post">
        {accounts.length === 0 ? (
          <p className="text-sm text-muted">
            No connected account yet.{" "}
            <Link href="/dashboard/social" className="underline">
              Connect one
            </Link>{" "}
            first.
          </p>
        ) : (
          <Composer
            accounts={accounts}
            initialKey={randomBytes(16).toString("base64url")}
            requireApproval={publishConfig.requireApproval}
          />
        )}
      </Card>
      <Card title={`Calendar · ${month}`}>
        <nav className="mb-3 flex gap-4 text-sm">
          <Link href={`?month=${shift(-1)}`} className="underline">
            Previous month
          </Link>
          <Link href={`?month=${shift(1)}`} className="underline">
            Next month
          </Link>
        </nav>
        <div
          className="grid grid-cols-7 gap-1 text-xs"
          role="grid"
          aria-label={`Posts in ${month}`}
        >
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="p-1 font-medium text-muted">
              {d}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const day = `${month}-${String(i + 1).padStart(2, "0")}`;
            const items = posts.filter((p) => dayOf(p) === day);
            return (
              <div key={day} className="min-h-16 rounded border border-line p-1" data-day={day}>
                <div className="text-muted">{i + 1}</div>
                {items.map((p) => (
                  <Link
                    key={p.id}
                    href={`/dashboard/social/posts/${p.id}`}
                    className="block truncate underline"
                  >
                    {isNetwork(p.network) ? NETWORK_LABEL[p.network] : p.network} ·{" "}
                    {STATUS_LABEL[p.status] ?? p.status}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Posts">
        {posts.length === 0 ? (
          <p className="text-sm text-muted">No posts this month.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {posts.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-line p-3 text-sm"
                data-testid="social-post"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{p.accountName}</strong>
                  <span className="text-muted">
                    {isNetwork(p.network) ? NETWORK_LABEL[p.network] : p.network}
                  </span>
                  <span data-testid="post-status">{STATUS_LABEL[p.status] ?? p.status}</span>
                  <span className="text-muted">
                    {formatDateTime(p.scheduledAt, p.scheduledTimeZone)}
                  </span>
                  <Link href={`/dashboard/social/posts/${p.id}`} className="underline">
                    Details and log
                  </Link>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{p.text}</p>
                {p.lastError ? <p className="mt-1 text-xs text-danger">{p.lastError}</p> : null}
                <PostButtons
                  id={p.id}
                  status={p.status}
                  approver={approver}
                  back="/dashboard/social/posts"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
