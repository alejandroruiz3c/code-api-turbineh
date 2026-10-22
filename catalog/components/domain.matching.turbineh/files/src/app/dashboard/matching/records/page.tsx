import Link from "next/link";
import { RecordForm } from "@/components/matching/forms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parsePage } from "@/lib/pagination";
import { capitalize, matchingConfig } from "@/matching/config";
import { mayCreateRecords } from "@/matching/policy";
import { parseFilters } from "@/matching/rules";
import { listRecords } from "@/matching/service";
import { requireMember } from "@/server/authz";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** All records of the active organization with text search and filters (sector, region, status, deadline). */
export default async function RecordsPage({ searchParams }: Props) {
  const ctx = await requireMember();
  const q = await searchParams;
  const filters = parseFilters(q);
  const { page, offset, limit } = parsePage(q.page);
  const rows = await listRecords(ctx, filters, { limit: limit + 1, offset });
  const { singular, plural } = matchingConfig.entity;
  const query = (p: number) =>
    `/dashboard/matching/records?${new URLSearchParams([
      ...Object.entries(filters).filter(([, v]) => v !== ""),
      ["page", String(p)],
    ])}`;
  return (
    <div className="flex flex-col gap-6">
      <Card title={capitalize(plural)}>
        <form
          method="get"
          aria-label="Filters"
          className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6"
        >
          <div className="col-span-2">
            <Label htmlFor="filter-q">Search</Label>
            <Input
              id="filter-q"
              name="q"
              defaultValue={filters.q}
              placeholder="Title or description"
            />
          </div>
          <div>
            <Label htmlFor="filter-sector">Sector</Label>
            <Input id="filter-sector" name="sector" defaultValue={filters.sector} />
          </div>
          <div>
            <Label htmlFor="filter-region">Region</Label>
            <Input id="filter-region" name="region" defaultValue={filters.region} />
          </div>
          <div>
            <Label htmlFor="filter-status">Status</Label>
            <select
              id="filter-status"
              name="status"
              defaultValue={filters.status}
              className="w-full rounded-md border border-field px-3 py-2 text-sm"
            >
              <option value="">Any</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div>
            <Label htmlFor="filter-before">Deadline before</Label>
            <Input id="filter-before" name="before" type="date" defaultValue={filters.before} />
          </div>
          <div className="col-span-2 md:col-span-6">
            <Button type="submit">Apply filters</Button>
          </div>
        </form>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1">Title</th>
              <th className="py-1">Sector</th>
              <th className="py-1">Region</th>
              <th className="py-1">Deadline</th>
              <th className="py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.id} data-testid="record-row" className="border-t border-line">
                <td className="py-1">
                  <Link href={`/dashboard/matching/records/${r.id}`} className="text-accent">
                    {r.title}
                  </Link>
                </td>
                <td className="py-1">{r.sector ?? ""}</td>
                <td className="py-1">{r.region ?? ""}</td>
                <td className="py-1">{r.deadline ?? ""}</td>
                <td className="py-1">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="mt-2 text-sm text-muted">No {plural} found.</p> : null}
        <nav aria-label="Pagination" className="mt-4 flex gap-4 text-sm">
          {page > 1 ? <Link href={query(page - 1)}>Previous</Link> : null}
          {rows.length > limit ? <Link href={query(page + 1)}>Next</Link> : null}
        </nav>
      </Card>
      {mayCreateRecords(ctx.role) ? (
        <Card title={`Add ${singular}`}>
          <RecordForm singular={singular} />
        </Card>
      ) : null}
    </div>
  );
}
