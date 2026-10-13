import { dataset as ds, PERIODS, type Period } from "./config";
import type { Filters } from "./service";

/**
 * Dashboard filters from the query string (component data.analytics-import.turbineh): date range (default: the 30
 * days up to the latest data), period, scope value. Shared by the page and the CSV exports so both show the same rows.
 */
type Query = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const isDay = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function parseFilters(q: Query, last: string | null): Filters & { period: Period } {
  const to = isDay(one(q.to)) ? one(q.to) : (last ?? new Date().toISOString().slice(0, 10));
  const from = isDay(one(q.from))
    ? one(q.from)
    : new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const p = one(q.period) as Period;
  const period = PERIODS.includes(p) && ds.periods.includes(p) ? p : ds.periods[0]!;
  const scopeValue = one(q.scope).slice(0, 120);
  return from <= to ? { from, to, period, scopeValue } : { from: to, to: from, period, scopeValue };
}

export function filterQuery(f: Filters & { period: Period }, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    from: f.from,
    to: f.to,
    period: f.period,
    ...(f.scopeValue ? { scope: f.scopeValue } : {}),
    ...extra,
  }).toString();
}
