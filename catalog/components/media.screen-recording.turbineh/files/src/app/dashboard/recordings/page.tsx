import Link from "next/link";
import { Card } from "@/components/ui/card";
import { durationLabel, LAYOUT_LABELS, type LayoutKey } from "@/recordings/config";
import { listRecordings } from "@/recordings/service";
import { requireMember } from "@/server/authz";

export const dynamic = "force-dynamic";

/** Video library of the workspace (media.screen-recording.turbineh): every recording with what was really recorded. */
export default async function RecordingsPage() {
  const ctx = await requireMember();
  const rows = await listRecordings(ctx);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recordings</h1>
        <Link
          href="/dashboard/recordings/new"
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-contrast hover:opacity-90"
        >
          New recording
        </Link>
      </div>
      <Card>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No recordings yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-2">Title</th>
                <th>Duration</th>
                <th>Recorded at</th>
                <th>Layout</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid="recording-row" className="border-t border-line">
                  <td className="py-2">
                    <Link
                      className="text-accent hover:underline"
                      href={`/dashboard/recordings/${r.id}`}
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td>{durationLabel(r.durationMs)}</td>
                  <td>
                    {r.width}×{r.height}
                  </td>
                  <td>{LAYOUT_LABELS[r.layout as LayoutKey] ?? r.layout}</td>
                  <td>{r.createdAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
