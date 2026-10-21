import Link from "next/link";
import { Table } from "@/components/ui/table";
import { recommendationConfig as cfg } from "@/recommendations/config";
import { formatMoney } from "@/recommendations/search";
import { recentProfiles } from "@/recommendations/store";
import { VIEWINGS_ENABLED, viewingsByItem } from "@/recommendations/viewing";
import { currentAdmin, requireMember } from "@/server/authz";

export const dynamic = "force-dynamic";

/** What people told the assistant they look for, and the viewings it booked (component ai.recommendations.turbineh). ADMIN_EMAILS only. */
export default async function Leads() {
  await requireMember();
  if (!(await currentAdmin()))
    return <p role="status">Only staff can see what {cfg.customer.plural} look for.</p>;
  const [profiles, viewings] = await Promise.all([recentProfiles(), viewingsByItem()]);
  const needs = (n: Record<string, string | number>) =>
    cfg.fields
      .filter((f) => n[f.key] !== undefined)
      .map((f) => `${f.label}: ${String(n[f.key])}`)
      .join(", ") || "—";
  return (
    <div className="flex flex-col gap-6">
      <Link className="text-sm underline" href="/dashboard/catalog">
        ← {cfg.item.plural}
      </Link>
      <h1 className="text-2xl font-semibold">What {cfg.customer.plural} look for</h1>
      <Table head={["Updated", "Budget", "Location", "Needs"]}>
        {profiles.map((p) => (
          <tr key={p.id} data-profile={p.id}>
            <td className="px-3 py-2">
              {p.updatedAt.toISOString().slice(0, 16).replace("T", " ")}
            </td>
            <td className="px-3 py-2">
              {p.budgetMax === null ? "—" : formatMoney(Number(p.budgetMax), cfg.currency)}
            </td>
            <td className="px-3 py-2">{p.location ?? "—"}</td>
            <td className="px-3 py-2">{needs(p.needs ?? {})}</td>
          </tr>
        ))}
      </Table>
      {profiles.length === 0 ? (
        <p className="text-sm text-muted">No preferences recorded yet.</p>
      ) : null}
      {VIEWINGS_ENABLED ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Viewings</h2>
          <Table head={[cfg.item.singular, "Booking", "When", cfg.customer.singular]}>
            {viewings.map((v) => (
              <tr key={v.appointment} data-viewing={v.appointment}>
                <td className="px-3 py-2 font-mono">{v.item}</td>
                <td className="px-3 py-2 font-mono">{v.appointment}</td>
                <td className="px-3 py-2">{v.when}</td>
                <td className="px-3 py-2">{v.customer}</td>
              </tr>
            ))}
          </Table>
        </section>
      ) : null}
    </div>
  );
}
