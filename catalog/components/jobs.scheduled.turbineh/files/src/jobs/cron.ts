/**
 * Five-field cron expressions evaluated in an IANA time zone (component jobs.scheduled.turbineh), no dependency:
 * "minute hour day-of-month month day-of-week" with `*`, numbers, lists, ranges and steps ("*\/15", "1-5", "0,30").
 * Day-of-week 0 and 7 are Sunday; when both day fields are restricted either may match (classic cron). Pure functions,
 * unit-tested in tests/unit/scheduled-jobs.test.ts (DST included).
 */
const RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

export interface Cron {
  fields: Set<number>[];
  domAny: boolean;
  dowAny: boolean;
}

function parseField(text: string, [min, max]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`invalid cron field "${text}"`);
    const step = m[2] ? Number(m[2]) : 1;
    let [from, to] = [min, max];
    if (m[1] !== "*") {
      const [a, b] = (m[1] ?? "").split("-").map(Number) as [number, number | undefined];
      from = a;
      to = b ?? (m[2] ? max : a);
    }
    if (step < 1 || from < min || to > max || from > to)
      throw new Error(`cron field "${text}" out of range ${min}-${max}`);
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron "${expr}" must have 5 fields`);
  const fields = parts.map((p, i) => parseField(p, RANGES[i]!));
  if (fields[4]!.has(7)) fields[4]!.add(0);
  return { fields, domAny: parts[2] === "*", dowAny: parts[4] === "*" };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Local wall-clock parts of an instant in `timeZone`. */
export function localParts(at: Date, timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday ?? "");
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    dow,
  };
}

export function matches(cron: Cron, at: Date, timeZone: string): boolean {
  const p = localParts(at, timeZone);
  const [mi, h, dom, mon, dow] = cron.fields as [
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
  ];
  if (!mi.has(p.minute) || !h.has(p.hour) || !mon.has(p.month)) return false;
  const domOk = dom.has(p.day);
  const dowOk = dow.has(p.dow);
  if (cron.domAny || cron.dowAny) return domOk && dowOk;
  return domOk || dowOk;
}

/**
 * The latest scheduled instant at or before `now` (minute precision), looking back at most `lookbackDays`; null when
 * none. A run is identified by this instant, which is what makes runs idempotent.
 */
export function lastOccurrence(
  expr: string,
  timeZone: string,
  now: Date,
  lookbackDays = 8,
): Date | null {
  const cron = parseCron(expr);
  const start = Math.floor(now.getTime() / 60_000) * 60_000;
  for (let i = 0; i <= lookbackDays * 24 * 60; i++) {
    const at = new Date(start - i * 60_000);
    if (matches(cron, at, timeZone)) return at;
  }
  return null;
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
