/** Pure tracker maths (recipe tracker), unit-tested in tests/unit/streaks.test.ts. Days are UTC ISO dates. */

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const cents = (v: number) => Math.round(v * 100);

/** Total per day in cents-exact arithmetic. */
export function totalsByDay(logs: { day: string; value: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of logs) m.set(l.day, (m.get(l.day) ?? 0) + cents(l.value));
  return new Map([...m].map(([d, c]) => [d, c / 100]));
}

/** Consecutive days meeting the target, ending today (or yesterday if today is not done yet). */
export function streak(totals: Map<string, number>, target: number, today: string): number {
  const met = (d: string) => (totals.get(d) ?? 0) >= target;
  let t = Date.parse(`${today}T00:00:00Z`);
  if (!met(iso(t))) t -= DAY;
  let n = 0;
  while (met(iso(t)) && n < 3650) {
    n++;
    t -= DAY;
  }
  return n;
}

/** Last `n` days (oldest first) with total and whether the target was met. */
export function history(totals: Map<string, number>, target: number, today: string, n = 30) {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const day = iso(end - (n - 1 - i) * DAY);
    const total = totals.get(day) ?? 0;
    return { day, total, met: total >= target };
  });
}

/** Share of days meeting the target over the history window, 0–100. */
export const completion = (h: { met: boolean }[]) =>
  h.length ? Math.round((h.filter((d) => d.met).length / h.length) * 100) : 0;
