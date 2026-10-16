import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PostButtons, STATUS_LABEL } from "@/components/social/post-buttons";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { formatDateTime } from "@/lib/datetime";
import { can, requireMember } from "@/server/authz";
import { isNetwork, NETWORK_LABEL } from "@/social/networks";
import { getPost } from "@/social/posts";

export const dynamic = "force-dynamic";

/** One social post (social.publish.turbineh): its text, status, link once published, and its publication log. */
export default async function SocialPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireMember();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const found = await getPost(ctx.organizationId, id.data);
  if (!found) notFound();
  const { post: p, log } = found;
  const q = await searchParams;
  const error = typeof q.error === "string" ? q.error.slice(0, 300) : null;
  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/social/posts" className="text-sm underline">
        Back to posts
      </Link>
      {error ? (
        <p role="alert" className="rounded-md border border-line bg-subtle p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Card
        title={`${p.accountName} · ${isNetwork(p.network) ? NETWORK_LABEL[p.network] : p.network}`}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Status</dt>
          <dd data-testid="post-status">{STATUS_LABEL[p.status] ?? p.status}</dd>
          <dt className="text-muted">Publish at</dt>
          <dd>{formatDateTime(p.scheduledAt, p.scheduledTimeZone)}</dd>
          <dt className="text-muted">Attempts</dt>
          <dd>
            {p.attempts} of {p.maxAttempts}
            {p.status === "retrying" && p.nextAttemptAt
              ? ` · next ${formatDateTime(p.nextAttemptAt, "UTC")}`
              : ""}
          </dd>
          {p.externalUrl ? (
            <>
              <dt className="text-muted">Published</dt>
              <dd>
                <a
                  href={p.externalUrl}
                  className="underline"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {p.externalId}
                </a>
              </dd>
            </>
          ) : p.externalId ? (
            <>
              <dt className="text-muted">Published</dt>
              <dd>{p.externalId}</dd>
            </>
          ) : null}
          {p.imageUrl ? (
            <>
              <dt className="text-muted">Image</dt>
              <dd className="break-all">{p.imageUrl}</dd>
            </>
          ) : null}
        </dl>
        <p className="mt-3 whitespace-pre-wrap text-sm">{p.text}</p>
        {p.lastError ? <p className="mt-2 text-sm text-danger">{p.lastError}</p> : null}
        <PostButtons
          id={p.id}
          status={p.status}
          approver={can(ctx.role, "approve")}
          back={`/dashboard/social/posts/${p.id}`}
        />
      </Card>
      <Card title="Publication log">
        <Table head={["When (UTC)", "Event", "Attempt", "HTTP", "Detail"]}>
          {log.map((l) => (
            <tr key={l.id} className="border-b border-line" data-testid="log-entry">
              <td className="px-3 py-2">{l.at.toISOString().replace("T", " ").slice(0, 19)}</td>
              <td className="px-3 py-2">{l.event}</td>
              <td className="px-3 py-2">{l.attempt || ""}</td>
              <td className="px-3 py-2">{l.httpStatus ?? ""}</td>
              <td className="px-3 py-2">{l.detail ?? ""}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
