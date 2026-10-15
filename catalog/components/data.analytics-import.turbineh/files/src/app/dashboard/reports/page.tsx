import Link from "next/link";
import { Bars } from "@/components/analytics-import/bars";
import { Card } from "@/components/ui/card";
import { dataset as ds, label } from "@/analytics-import/config";
import { filterQuery, parseFilters } from "@/analytics-import/filters";
import { change, previousRange } from "@/analytics-import/rules";
import { byDimension, lastDay, scopeValues, series, totals } from "@/analytics-import/service";
import { requireMember } from "@/server/authz";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Analytics dashboard (data.analytics-import.turbineh): totals vs the previous period, measures by day/week/month, top
 * values of each dimension and a comparison between scope values (shops), with date range and scope filters; every
 * chart exports as CSV. Each person sees only the scopes they may see.
 */
export default async function ReportsPage({ searchParams }: Props) {
  const ctx = await requireMember();
  const f = parseFilters(await searchParams, await lastDay(ctx));
  const prev = previousRange(f.from, f.to);
  const main = ds.measures[0]!;
  const others = ds.dimensions.filter((d) => d !== ds.scope);
  const [now, before, perPeriod, compare, values, tops] = await Promise.all([
    totals(ctx, f),
    totals(ctx, { ...f, ...prev }),
    series(ctx, f, f.period),
    ds.scope ? byDimension(ctx, f, ds.scope) : Promise.resolve([]),
    scopeValues(ctx),
    Promise.all(others.map((d) => byDimension(ctx, f, d, 10))),
  ]);
  const exportLink = (chart: string) => `/dashboard/reports/export?${filterQuery(f, { chart })}`;
  const select = "rounded-md border border-field px-3 py-2 text-sm";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">{label(ds.entity)} dashboard</h1>
        <Link href="/dashboard/reports/import" className="text-sm text-accent underline">
          Import CSV
        </Link>
      </div>
      <form method="get" aria-label="Filters" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="r-from" className="text-sm text-muted">
            From
          </label>
          <input id="r-from" name="from" type="date" defaultValue={f.from} className={select} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="r-to" className="text-sm text-muted">
            To
          </label>
          <input id="r-to" name="to" type="date" defaultValue={f.to} className={select} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="r-period" className="text-sm text-muted">
            Period
          </label>
          <select id="r-period" name="period" defaultValue={f.period} className={select}>
            {ds.periods.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
        </div>
        {ds.scope ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="r-scope" className="text-sm text-muted">
              {label(ds.scope)}
            </label>
            <select id="r-scope" name="scope" defaultValue={f.scopeValue} className={select}>
              <option value="">All</option>
              {values.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <button
          type="submit"
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-contrast"
        >
          Apply
        </button>
      </form>
      <section aria-label="Totals" className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {ds.measures.map((m) => {
          const delta = ds.compare ? change(now[m] ?? 0, before[m] ?? 0) : null;
          return (
            <div
              key={m}
              className="rounded-lg border border-line bg-panel p-4"
              data-testid={`kpi-${m}`}
            >
              <div className="text-sm text-muted">{label(m)}</div>
              <div className="text-2xl font-semibold" data-testid={`total-${m}`}>
                {num(now[m] ?? 0)}
              </div>
              {ds.compare ? (
                <div className="text-xs text-muted" data-testid={`change-${m}`}>
                  {delta === null
                    ? "No data in the previous period"
                    : `${delta > 0 ? "+" : ""}${delta}% vs previous period`}{" "}
                  ({prev.from} – {prev.to}: {num(before[m] ?? 0)})
                </div>
              ) : null}
            </div>
          );
        })}
      </section>
      <Card title={`${label(main)} by ${f.period}`}>
        <Bars
          rows={perPeriod.map((r) => ({ label: r.period, value: Number(r[main] ?? 0) }))}
          caption={label(f.period)}
          measure={label(main)}
          testId="series"
        />
        {ds.exportCsv ? (
          <a
            className="mt-2 inline-block text-sm text-accent underline"
            href={exportLink("series")}
          >
            Export CSV
          </a>
        ) : null}
      </Card>
      {ds.scope ? (
        <Card title={`Comparison by ${label(ds.scope).toLowerCase()}`}>
          <Bars
            rows={compare.map((r) => ({ label: r.value, value: Number(r[main] ?? 0) }))}
            caption={label(ds.scope)}
            measure={label(main)}
            testId="compare"
          />
          {ds.exportCsv ? (
            <a
              className="mt-2 inline-block text-sm text-accent underline"
              href={exportLink("compare")}
            >
              Export CSV
            </a>
          ) : null}
        </Card>
      ) : null}
      {others.map((d, i) => (
        <Card key={d} title={`Top ${label(d).toLowerCase()}`}>
          <Bars
            rows={(tops[i] ?? []).map((r) => ({ label: r.value, value: Number(r[main] ?? 0) }))}
            caption={label(d)}
            measure={label(main)}
            testId={`top-${d}`}
          />
          {ds.exportCsv ? (
            <a
              className="mt-2 inline-block text-sm text-accent underline"
              href={exportLink(`top-${d}`)}
            >
              Export CSV
            </a>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
