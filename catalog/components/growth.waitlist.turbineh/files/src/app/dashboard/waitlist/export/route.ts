import { toCsv } from "@/lib/csv";
import { requireAdmin } from "@/server/authz";
import { waitlistConfig as cfg } from "@/waitlist/config";
import { listSignups } from "@/waitlist/service";

/** GET /dashboard/waitlist/export — the waitlist as CSV (staff only), best position first. */
export async function GET(): Promise<Response> {
  await requireAdmin();
  if (!cfg.ownerCanExport) return new Response("Not found", { status: 404 });
  const rows = await listSignups(100_000);
  const csv = toCsv(
    rows.map((r) => ({
      position: r.position ?? "",
      name: r.name,
      email: r.email,
      status: r.status,
      referrals: r.referrals,
      joined: r.createdAt.toISOString(),
      confirmed: r.confirmedAt?.toISOString() ?? "",
    })),
    ["position", "name", "email", "status", "referrals", "joined", "confirmed"],
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="waitlist.csv"',
      "Cache-Control": "no-store",
    },
  });
}
