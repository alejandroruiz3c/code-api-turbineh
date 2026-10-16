import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StateBadge, Stat, pct, secs } from "@/components/ui";
import { summarize, workspaceActivity } from "@/server/activity";
import { getCaller } from "@/server/caller";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity · YES IF for Builders" };

/** Workspace activity & reports: measured figures per flow (no internal cost is ever shown). */
export default async function ActivityPage() {
  const caller = await getCaller();
  if (!caller) redirect("/access?next=/activity");
  const items = await workspaceActivity(caller.ownerId, 100);
  const s = summarize(items);
  const newLines = items.reduce((a, i) => a + (i.generatedLines ?? 0), 0);
  return (
    <main className="mx-auto max-w-6xl px-6 pt-8">
      <p className="eyebrow">Activity &amp; reports</p>
      <h1 className="display mt-2 text-3xl font-semibold text-cream">
        What your workspace got done
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Every figure is measured on your own flows. The same report is available to your tools at{" "}
        <code className="text-teal">GET /v1/activity</code> and with{" "}
        <code className="text-teal">turbineh status --json</code>.
      </p>

      <section
        aria-label="Summary"
        className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6"
      >
        <Stat value={`${s.verified}/${s.flows}`} label="Flows verified" accent />
        <Stat value={secs(s.avgSeconds)} label="Average time to a verified package" />
        <Stat value={pct(s.avgReusedShare)} label="Code reused from verified components" />
        <Stat value={s.reusedLines.toLocaleString("en")} label="Lines you did not have to write" />
        <Stat value={newLines.toLocaleString("en")} label="New lines to maintain (glue)" />
        <Stat
          value={String(s.securityFixed)}
          label="Security issues fixed before delivery (confirmed by a new scan)"
        />
      </section>

      <section aria-label="Flows" className="mt-10">
        {items.length === 0 ? (
          <p className="text-sm text-muted">
            No flows yet.{" "}
            <Link href="/flows/new" className="text-teal underline">
              Start one
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Flows of this workspace</caption>
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-3 font-normal">
                    State
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal">
                    Need
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal">
                    Flow
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal">
                    Time
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal">
                    Reused
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal">
                    Checks
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal">
                    Security fixed
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal">
                    Pull request
                  </th>
                  <th scope="col" className="px-4 py-3 font-normal">
                    When
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b border-line/60 hover:bg-panel/30">
                    <td className="px-4 py-3">
                      <StateBadge state={i.state} />
                    </td>
                    <td className="max-w-[320px] truncate px-4 py-3">
                      <Link href={`/flows/${i.id}`} className="text-ice-2 hover:text-teal">
                        {i.need}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{i.useCase ?? "—"}</td>
                    <td className="px-4 py-3 text-ice-2">{secs(i.seconds)}</td>
                    <td className="px-4 py-3 text-ice-2">{pct(i.reusedShare)}</td>
                    <td className="px-4 py-3 text-ice-2">
                      {i.checksTotal ? `${i.checksPassed}/${i.checksTotal}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-ice-2">{i.securityFixed}</td>
                    <td className="px-4 py-3 text-xs">
                      {i.pullRequest?.url ? (
                        <a
                          href={i.pullRequest.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={i.pullRequest.verified ? "text-teal" : "text-amber"}
                        >
                          {i.pullRequest.repo} ↗{" "}
                          {i.pullRequest.verified
                            ? "verified"
                            : i.pullRequest.running
                              ? "verifying"
                              : "draft"}
                        </a>
                      ) : i.pullRequest?.running ? (
                        <span className="text-muted">{i.pullRequest.repo} · in progress</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {i.createdAt.slice(0, 16).replace("T", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
