import { z } from "zod";

/**
 * Dates and times typed in a form (ADR-0054). A `datetime-local` input has no time zone: the app stores the instant
 * in UTC together with the IANA zone it was typed in (`<field>TimeZone`), so "10:30" means the same moment for every
 * reader and is shown back in the zone it was typed in. No dependencies: the platform's Intl does the zone math.
 */

/** "YYYY-MM-DDTHH:mm" (optionally ":ss"), as a datetime-local input sends it. */
export const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Whether `zone` is an IANA time zone this runtime knows ("Europe/Madrid", "UTC"). */
export function isTimeZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Schema of a typed local date and time (kept as typed; converted with its zone when stored). */
export const localDateTime = z
  .string()
  .trim()
  .regex(LOCAL_DATE_TIME, "Use a date and time")
  .refine((v) => {
    const m = LOCAL_DATE_TIME.exec(v);
    if (!m) return false;
    const [y, mo, d, h, mi] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
    const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
    return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && h < 24 && mi < 60;
  }, "Use a real date and time");

/** Schema of the zone a date and time was typed in: an IANA zone, "UTC" when none is sent. */
export const timeZone = z
  .string()
  .trim()
  .max(64)
  .optional()
  .transform((v) => v || "UTC")
  .refine(isTimeZone, "Unknown time zone");

/** Offset (ms) of `zone` from UTC at the instant `t`. */
function offsetAt(t: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** The UTC instant of a local date and time typed in `zone` (daylight-saving transitions resolved forward). */
export function zonedToUtc(local: string, zone: string): Date {
  const m = LOCAL_DATE_TIME.exec(local);
  if (!m) throw new Error("Invalid local date and time");
  const [y, mo, d, h, mi, s = 0] = m.slice(1).map((x) => Number(x ?? 0)) as number[];
  const wall = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s);
  const tz = isTimeZone(zone) ? zone : "UTC";
  let t = wall - offsetAt(wall, tz);
  // A second pass settles instants near a daylight-saving change.
  t = wall - offsetAt(t, tz);
  return new Date(t);
}

/** A stored instant as the value of a datetime-local input, in the zone it was typed in. */
export function toDateTimeInput(
  value: Date | null | undefined,
  zone: string | null | undefined,
): string {
  if (!value) return "";
  const tz = zone && isTimeZone(zone) ? zone : "UTC";
  const local = new Date(value.getTime() + offsetAt(value.getTime(), tz));
  return local.toISOString().slice(0, 16);
}

/** A stored instant for people: in the zone it was typed in, with the zone named. */
export function formatDateTime(
  value: Date | null | undefined,
  zone: string | null | undefined,
): string {
  if (!value) return "";
  const tz = zone && isTimeZone(zone) ? zone : "UTC";
  return `${toDateTimeInput(value, tz).replace("T", " ")} (${tz})`;
}
