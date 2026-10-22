import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table } from "@/components/ui/table";
import { recommendationConfig as cfg } from "@/recommendations/config";
import { formatMoney } from "@/recommendations/search";
import { allItems } from "@/recommendations/store";
import { currentAdmin, requireMember } from "@/server/authz";
import { setVerified } from "./actions";
import { ItemForm } from "./item-form";

export const dynamic = "force-dynamic";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Staff view of the catalogue the assistant recommends from (component ai.recommendations.turbineh). ADMIN_EMAILS only. */
export default async function Catalog() {
  await requireMember();
  if (!(await currentAdmin())) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{cap(cfg.item.plural)}</h1>
        <p className="text-muted" role="status">
          Only staff can manage the catalogue. Ask the owner to add your email to ADMIN_EMAILS.
        </p>
      </div>
    );
  }
  const rows = await allItems();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{cap(cfg.item.plural)}</h1>
        <Link className="text-sm underline" href="/dashboard/catalog/leads">
          What {cfg.customer.plural} look for
        </Link>
      </div>
      <p className="text-sm text-muted">
        The assistant recommends, describes and compares only verified, active {cfg.item.plural} —
        never anything else.
      </p>
      <Table
        head={[
          "Reference",
          "Title",
          "Price",
          "Location",
          ...cfg.fields.map((f) => f.label),
          "Verified",
          "",
        ]}
      >
        {rows.map((r) => (
          <tr key={r.id} data-reference={r.reference}>
            <td className="px-3 py-2 font-mono">
              <Link className="underline" href={`/dashboard/catalog/${r.id}`}>
                {r.reference}
              </Link>
            </td>
            <td className="px-3 py-2">{r.title}</td>
            <td className="px-3 py-2">{formatMoney(Number(r.price), r.currency)}</td>
            <td className="px-3 py-2">{r.location}</td>
            {cfg.fields.map((f) => (
              <td key={f.key} className="px-3 py-2">
                {String(r.attributes?.[f.key] ?? "—")}
              </td>
            ))}
            <td className="px-3 py-2">
              {r.verified ? "verified" : "not verified"}
              {r.active ? "" : " · inactive"}
            </td>
            <td className="px-3 py-2">
              <form action={setVerified}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="verified" value={r.verified ? "false" : "true"} />
                <Button type="submit" className="px-2 py-1 text-xs">
                  {r.verified ? "Unverify" : "Mark verified"}
                </Button>
              </form>
            </td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 ? <p className="text-sm text-muted">No {cfg.item.plural} yet.</p> : null}
      <h2 className="text-lg font-semibold">Add a {cfg.item.singular}</h2>
      <ItemForm fields={cfg.fields} currency={cfg.currency} />
    </div>
  );
}
