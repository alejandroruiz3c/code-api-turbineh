/**
 * Wall-clock ↔ instant conversions for an IANA time zone, DST-correct, with no dependency (component
 * domain.bookings.turbineh). Local times that do not exist (spring-forward gap) return null; ambiguous ones
 * (fall-back overlap) resolve to the first occurrence.
 */
const pad = (n: number) => String(n).padStart(2, "0");

export const isDay = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

export const isTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Local calendar parts of an instant in `timeZone`. */
export function zonedParts(at: Date, timeZone: string) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(at).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset of `timeZone` from UTC at an instant, in milliseconds. */
export function offsetMs(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** "YYYY-MM-DD" + "HH:MM" in `timeZone` → instant; null when that local time does not exist (DST gap). */
export function zonedToUtc(day: string, time: string, timeZone: string): Date | null {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Try both offsets around the guess; keep candidates whose local time is exactly the requested one.
  const candidates = [
    guess - offsetMs(new Date(guess - 12 * 3_600_000), timeZone),
    guess - offsetMs(new Date(guess + 12 * 3_600_000), timeZone),
  ]
    .filter((t) => {
      const p = zonedParts(new Date(t), timeZone);
      return p.year === y && p.month === m && p.day === d && p.hour === hh && p.minute === mm;
    })
    .sort((a, b) => a - b);
  return candidates.length ? new Date(candidates[0] as number) : null;
}

/** Instant → local day "YYYY-MM-DD" in `timeZone`. */
export function localDay(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Instant → local time "HH:MM" in `timeZone`. */
export function localTime(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar day. */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export const minutesOf = (time: string): number => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

export const timeOf = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** "Tuesday 2026-10-20 10:30" in the business time zone. */
export function describeLocal(at: Date, timeZone: string): string {
  const day = localDay(at, timeZone);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(at);
  return `${name} ${day} ${localTime(at, timeZone)}`;
}
