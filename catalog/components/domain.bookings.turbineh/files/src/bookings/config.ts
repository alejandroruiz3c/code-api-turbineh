import { z } from "zod";
import params from "./params.json";

/**
 * Booking domain parameters (component domain.bookings.turbineh, ADR-0033). params.json is written by TurbineH from
 * the request (business name, team, services and prices, opening hours, time zone, notice policy, questions to
 * answer); edit it to change them. Validated at start-up: a wrong value fails loudly instead of inventing slots.
 */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM (24 h)");

export const isTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const BookingParams = z
  .object({
    business: z.string().trim().min(1).max(80),
    timeZone: z.string().refine(isTimeZone, "unknown IANA time zone"),
    resource: z.object({
      singular: z.string().trim().min(1).max(40),
      plural: z.string().trim().min(1).max(40),
      count: z.number().int().min(1).max(50),
      names: z.array(z.string().trim().min(1).max(80)).max(50),
    }),
    customer: z.object({
      singular: z.string().trim().min(1).max(40),
      plural: z.string().trim().min(1).max(40),
    }),
    services: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          minutes: z.number().int().min(5).max(480),
          price: z.number().min(0).max(1_000_000).nullable(),
          currency: z.string().min(1).max(8).nullable(),
        }),
      )
      .min(1)
      .max(20),
    /** Grid of possible start times (minutes from each opening time). */
    slotMinutes: z.number().int().min(5).max(240),
    /** Opening windows per ISO weekday (1 = Monday … 7 = Sunday), local time of `timeZone`. */
    hours: z
      .array(z.object({ weekday: z.number().int().min(1).max(7), open: hhmm, close: hhmm }))
      .min(1)
      .max(28),
    policy: z.object({
      /** Moving or cancelling is allowed only this many hours before the start. */
      cancelNoticeHours: z.number().min(0).max(720),
      /** New bookings must start at least this many minutes from now. */
      bookingNoticeMinutes: z.number().int().min(0).max(10_080),
      /** How far ahead people can book. */
      horizonDays: z.number().int().min(1).max(365),
    }),
    /** Questions the assistant answers; `answer: null` = not published yet (staff fill it in, never invented). */
    faq: z
      .array(
        z.object({
          topic: z.string().trim().min(1).max(120),
          answer: z.string().trim().max(1000).nullable(),
        }),
      )
      .max(30),
  })
  .superRefine((p, ctx) => {
    p.hours.forEach((h, i) => {
      if (h.open >= h.close)
        ctx.addIssue({ code: "custom", path: ["hours", i], message: "open must be before close" });
    });
  });

export type BookingConfig = z.infer<typeof BookingParams>;

export const bookingConfig: BookingConfig = BookingParams.parse(params);

/** Price label, e.g. "60 €"; null when no price is published. */
export function priceLabel(s: BookingConfig["services"][number]): string | null {
  if (s.price === null) return null;
  const amount = Number.isInteger(s.price) ? String(s.price) : s.price.toFixed(2);
  const c = (s.currency ?? "").toUpperCase();
  if (c === "€" || c === "EUR") return `${amount} €`;
  if (c === "$" || c === "USD") return `$${amount}`;
  if (c === "£" || c === "GBP") return `£${amount}`;
  return c ? `${amount} ${c}` : amount;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "Monday: 09:00–19:00; Tuesday: …" in weekday order. */
export function hoursText(cfg: BookingConfig = bookingConfig): string {
  return [1, 2, 3, 4, 5, 6, 7]
    .map((d) => {
      const w = cfg.hours.filter((h) => h.weekday === d).sort((a, b) => a.open.localeCompare(b.open));
      return `${DAYS[d - 1]}: ${w.length ? w.map((h) => `${h.open}–${h.close}`).join(", ") : "closed"}`;
    })
    .join("; ");
}
