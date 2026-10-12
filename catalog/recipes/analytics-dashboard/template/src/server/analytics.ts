/** Pure analytics (recipe analytics-dashboard): exact cents arithmetic, unit-tested in tests/unit/analytics.test.ts. */

export interface Point {
  day: string;
  category: string;
  value: number;
}

const DAY = 86_400_000;
export const toCents = (v: string | number) => Math.round(Number(v) * 100);
const fromCents = (c: number) => c / 100;

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`) && out.length < 1000;
    t += DAY
  ) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** The period of the same length right before [from, to]. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const len = daysBetween(from, to).length;
  const end = new Date(Date.parse(`${from}T00:00:00Z`) - DAY);
  const start = new Date(end.getTime() - (len - 1) * DAY);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function kpis(points: Point[], previous: Point[], days: number) {
  const total = points.reduce((s, p) => s + toCents(p.value), 0);
  const prevTotal = previous.reduce((s, p) => s + toCents(p.value), 0);
  return {
    total: fromCents(total),
    count: points.length,
    perDay: fromCents(Math.round(total / Math.max(1, days))),
    change:
      prevTotal === 0 ? null : Math.round(((total - prevTotal) / Math.abs(prevTotal)) * 1000) / 10,
  };
}

/** Daily totals with missing days filled with 0 (a continuous line). */
export function dailySeries(
  points: Point[],
  from: string,
  to: string,
): { day: string; value: number }[] {
  const sums = new Map<string, number>();
  for (const p of points) sums.set(p.day, (sums.get(p.day) ?? 0) + toCents(p.value));
  return daysBetween(from, to).map((day) => ({ day, value: fromCents(sums.get(day) ?? 0) }));
}

/** Totals per category, largest first, the rest grouped as "Other". */
export function breakdown(points: Point[], top = 8): { category: string; value: number }[] {
  const sums = new Map<string, number>();
  for (const p of points) sums.set(p.category, (sums.get(p.category) ?? 0) + toCents(p.value));
  const sorted = [...sums.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, top).map(([category, c]) => ({ category, value: fromCents(c) }));
  const rest = sorted.slice(top).reduce((s, [, c]) => s + c, 0);
  return rest ? [...head, { category: "Other", value: fromCents(rest) }] : head;
}

export const fmt = (n: number, unit = "") =>
  `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(n)}${unit ? ` ${unit}` : ""}`;
