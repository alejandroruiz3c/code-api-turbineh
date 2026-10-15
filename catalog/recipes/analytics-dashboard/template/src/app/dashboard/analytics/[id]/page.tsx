import { and, between, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarList, LineChart } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { dataPoints, datasets } from "@/db/schema";
import { requireMember } from "@/server/authz";
import {
  breakdown,
  dailySeries,
  daysBetween,
  fmt,
  kpis,
  previousPeriod,
  type Point,
} from "@/server/analytics";
import { addPoint, importPoints } from "../actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/** One dataset: KPIs with period comparison, time series and breakdown charts, filters and export. */
export default async function DatasetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const ctx = await requireMember();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [ds] = await db
    .select()
    .from(datasets)
    .where(and(eq(datasets.id, id), eq(datasets.organizationId, ctx.organizationId)));
  if (!ds) notFound();
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const to = ISO.test(str(sp.to)) ? str(sp.to) : today;
  const from =
    ISO.test(str(sp.from)) && str(sp.from) <= to
      ? str(sp.from)
      : new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const category = str(sp.category).slice(0, 80);
  const prev = previousPeriod(from, to);
  const load = async (a: string, b: string): Promise<Point[]> =>
    (
      await db
        .select({ day: dataPoints.day, category: dataPoints.category, value: dataPoints.value })
        .from(dataPoints)
        .where(
          and(
            eq(dataPoints.datasetId, ds.id),
            between(dataPoints.day, a, b),
            category ? eq(dataPoints.category, category) : undefined,
          ),
        )
    ).map((r) => ({ day: r.day, category: r.category, value: Number(r.value) }));
  const [points, previous, latest] = await Promise.all([
    load(from, to),
    load(prev.from, prev.to),
    db
      .select()
      .from(dataPoints)
      .where(eq(dataPoints.datasetId, ds.id))
      .orderBy(desc(dataPoints.day))
      .limit(10),
  ]);
  const k = kpis(points, previous, daysBetween(from, to).length);
  const categories = [...new Set(latest.map((r) => r.category))];
  const query = `from=${from}&to=${to}${category ? `&category=${encodeURIComponent(category)}` : ""}`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/dashboard/analytics" className="text-sm underline">
            ← Analytics
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{ds.name}</h1>
        </div>
        <form className="flex flex-wrap items-end gap-2" role="search" aria-label="Filters">
          <div>
            <Label htmlFor="f-from">From</Label>
            <Input id="f-from" name="from" type="date" defaultValue={from} />
          </div>
          <div>
            <Label htmlFor="f-to">To</Label>
            <Input id="f-to" name="to" type="date" defaultValue={to} />
          </div>
          <div>
            <Label htmlFor="f-cat">Category</Label>
            <Input id="f-cat" name="category" defaultValue={category} list="cats" />
            <datalist id="cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <Button type="submit">Apply</Button>
          <a className="text-sm underline" href={`/dashboard/analytics/${ds.id}/export?${query}`}>
            Export CSV
          </a>
        </form>
      </div>

      <dl className="grid gap-4 md:grid-cols-4">
        {[
          ["Total", fmt(k.total, ds.unit)],
          ["Average per day", fmt(k.perDay, ds.unit)],
          ["Entries", String(k.count)],
          [
            "vs previous period",
            k.change === null ? "—" : `${k.change > 0 ? "+" : ""}${k.change}%`,
          ],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-panel p-4">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold" data-kpi={label}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Daily total">
            <LineChart
              data={dailySeries(points, from, to)}
              label={`${ds.name} daily total`}
              unit={ds.unit}
            />
          </Card>
        </div>
        <Card title="By category">
          <BarList data={breakdown(points)} unit={ds.unit} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Import CSV (columns: date, category, value)">
          <form action={importPoints} className="flex items-end gap-3">
            <input type="hidden" name="datasetId" value={ds.id} />
            <div>
              <Label htmlFor="imp-file">CSV file</Label>
              <input id="imp-file" name="file" type="file" accept=".csv,text/csv" required />
            </div>
            <Button type="submit">Import</Button>
          </form>
          {sp.imported ? (
            <p role="status" className="mt-2 text-sm text-muted">
              Imported {str(sp.imported)} rows, rejected {str(sp.rejected) || "0"}.
            </p>
          ) : null}
        </Card>
        <Card title="Add a value">
          <form action={addPoint} className="grid grid-cols-3 gap-2">
            <input type="hidden" name="datasetId" value={ds.id} />
            <div>
              <Label htmlFor="p-day">Date</Label>
              <Input id="p-day" name="day" type="date" defaultValue={today} required />
            </div>
            <div>
              <Label htmlFor="p-cat">Category</Label>
              <Input id="p-cat" name="category" maxLength={80} />
            </div>
            <div>
              <Label htmlFor="p-val">Value</Label>
              <Input id="p-val" name="value" type="number" step="0.01" required />
            </div>
            <div className="col-span-3">
              <Button type="submit">Add</Button>
            </div>
          </form>
        </Card>
      </div>

      <Card title="Latest entries">
        <Table head={["Date", "Category", "Value"]}>
          {latest.map((r) => (
            <tr key={r.id} className="border-b border-line">
              <td className="px-3 py-2">{r.day}</td>
              <td className="px-3 py-2">{r.category}</td>
              <td className="px-3 py-2">{fmt(Number(r.value), ds.unit)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
