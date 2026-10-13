import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { requireAdmin } from "@/server/authz";
import { waitlistConfig as cfg } from "@/waitlist/config";
import { counts, listSignups } from "@/waitlist/service";
import { removeSignup } from "./actions";

export const dynamic = "force-dynamic";

/** Waitlist for staff (growth.waitlist.turbineh): positions, confirmations, referrals, CSV export and removal. */
export default async function WaitlistAdmin() {
  await requireAdmin();
  const [rows, c] = await Promise.all([listSignups(), counts()]);
  return (
    <Card title={`Waitlist (${c.total})`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <span data-testid="waitlist-counts">
          {c.confirmed} confirmed · {c.total - c.confirmed} waiting for confirmation
        </span>
        {cfg.ownerCanExport ? (
          <a className="text-accent underline" href="/dashboard/waitlist/export" download>
            Export CSV
          </a>
        ) : null}
      </div>
      <Table head={["Position", "Name", "Email", "Status", "Referrals", "Joined", ""]}>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-line" data-testid="signup-row">
            <td className="px-3 py-2">{r.position ? `#${r.position}` : "—"}</td>
            <td className="px-3 py-2">{r.name}</td>
            <td className="px-3 py-2">{r.email}</td>
            <td className="px-3 py-2">{r.status}</td>
            <td className="px-3 py-2">{r.referrals}</td>
            <td className="px-3 py-2">{r.createdAt.toISOString().slice(0, 10)}</td>
            <td className="px-3 py-2">
              {cfg.ownerCanRemove ? (
                <form action={removeSignup}>
                  <input type="hidden" name="id" value={r.id} />
                  <Button type="submit" aria-label={`Remove ${r.email}`} className="bg-subtle px-2 py-1 text-xs text-ink">
                    Remove
                  </Button>
                </form>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 ? <p className="mt-4 text-sm text-muted">No signups yet.</p> : null}
    </Card>
  );
}
