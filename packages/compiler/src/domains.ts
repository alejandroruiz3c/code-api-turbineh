import { z } from "zod";

/**
 * Domain components (ADR-0033): reusable business domains (bookings today; orders, CRM, tickets next) that a
 * recipe can host. Detection and parameters come from the request **by code** (deterministic, no model): the same
 * prompt always yields the same parameters, and anything the prompt does not say is a documented default, never an
 * invented fact.
 */
export interface DomainSelection {
  /** Domain id, e.g. "bookings". */
  id: string;
  capability: string;
  component: string;
  /** Recipes that host this domain component. */
  recipes: string[];
  /** File in the app that receives `params` (JSON). */
  paramsFile: string;
  params: Record<string, unknown>;
  /** Entities the component implements: the generic CRUD generator never duplicates them. */
  providedEntities: string[];
  /** Defaults used because the request did not say (shown to the person and to coding agents). */
  assumptions: string[];
}

// ─── Bookings ────────────────────────────────────────────────────────────────────────────────────────────────

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const bookingParamsSchema = z.object({
  business: z.string().min(1).max(80),
  /** What kind of business the request says it is ("clinic", "salon", "studio"), or null. */
  businessKind: z.string().min(1).max(40).nullable().optional(),
  timeZone: z.string().min(1),
  resource: z.object({
    singular: z.string().min(1).max(40),
    plural: z.string().min(1).max(40),
    count: z.number().int().min(1).max(50),
    names: z.array(z.string().min(1).max(80)).max(50),
  }),
  customer: z.object({ singular: z.string().min(1).max(40), plural: z.string().min(1).max(40) }),
  services: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        minutes: z.number().int().min(5).max(480),
        price: z.number().min(0).nullable(),
        currency: z.string().max(8).nullable(),
      }),
    )
    .min(1)
    .max(20),
  slotMinutes: z.number().int().min(5).max(240),
  hours: z
    .array(z.object({ weekday: z.number().int().min(1).max(7), open: hhmm, close: hhmm }))
    .min(1),
  policy: z.object({
    cancelNoticeHours: z.number().min(0).max(720),
    bookingNoticeMinutes: z.number().int().min(0).max(10_080),
    horizonDays: z.number().int().min(1).max(365),
  }),
  faq: z
    .array(z.object({ topic: z.string().min(1).max(120), answer: z.string().max(1000).nullable() }))
    .max(30),
});
export type BookingParams = z.infer<typeof bookingParamsSchema>;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const NOT_RESOURCES = new Set([
  "hours",
  "minutes",
  "days",
  "weeks",
  "months",
  "years",
  "times",
  "sessions",
  "services",
  "euros",
  "dollars",
  "pounds",
  "seconds",
  "slots",
  "appointments",
  "bookings",
  "languages",
  "steps",
  "pages",
  "questions",
  "patients",
  "customers",
  "clients",
  "guests",
  "users",
  "visitors",
  "people",
]);
const CUSTOMER_NOUNS = [
  "patients",
  "clients",
  "customers",
  "guests",
  "diners",
  "students",
  "members",
  "visitors",
  "pet owners",
];
export const CITY_ZONES: Record<string, string> = {
  madrid: "Europe/Madrid",
  barcelona: "Europe/Madrid",
  valencia: "Europe/Madrid",
  sevilla: "Europe/Madrid",
  seville: "Europe/Madrid",
  lisbon: "Europe/Lisbon",
  london: "Europe/London",
  dublin: "Europe/Dublin",
  paris: "Europe/Paris",
  berlin: "Europe/Berlin",
  munich: "Europe/Berlin",
  rome: "Europe/Rome",
  milan: "Europe/Rome",
  amsterdam: "Europe/Amsterdam",
  brussels: "Europe/Brussels",
  zurich: "Europe/Zurich",
  vienna: "Europe/Vienna",
  "new york": "America/New_York",
  boston: "America/New_York",
  chicago: "America/Chicago",
  denver: "America/Denver",
  "los angeles": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  seattle: "America/Los_Angeles",
  "mexico city": "America/Mexico_City",
  "buenos aires": "America/Argentina/Buenos_Aires",
  "são paulo": "America/Sao_Paulo",
  "sao paulo": "America/Sao_Paulo",
  tokyo: "Asia/Tokyo",
  singapore: "Asia/Singapore",
  sydney: "Australia/Sydney",
};
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY = String.raw`(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?`;
const TIME = String.raw`(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
const DASH = String.raw`(?:–|—|-|to|until|till)`;

export const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const pad = (n: number) => String(n).padStart(2, "0");
const cap = (s: string) => (s ? (s[0] ?? "").toUpperCase() + s.slice(1) : s);
const singular = (w: string) =>
  /ies$/.test(w)
    ? w.replace(/ies$/, "y")
    : /(ss|ch|sh|x)es$/.test(w)
      ? w.replace(/es$/, "")
      : w.replace(/s$/, "");
const num = (s: string) => NUMBER_WORDS[s.toLowerCase()] ?? Number(s);
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

function clock(h: string, m: string | undefined, ampm: string | undefined): string | null {
  let hour = Number(h);
  const minute = m ? Number(m) : 0;
  const ap = ampm?.replace(/\./g, "").toLowerCase();
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  if (hour > 24 || minute > 59) return null;
  if (hour === 24) return minute === 0 ? "23:59" : null;
  return `${pad(hour)}:${pad(minute)}`;
}

/** "Monday–Friday", "Mon, Wed and Fri", "Sat" → ISO weekdays. */
function parseDays(phrase: string): number[] {
  const tokens =
    phrase.toLowerCase().match(/(mon|tue|wed|thu|fri|sat|sun)[a-z]*|–|—|-|to|through|thru/g) ?? [];
  const out = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? "";
    const d = DAYS.indexOf(t.slice(0, 3));
    if (d < 0) continue;
    const next = tokens[i + 1];
    const after = tokens[i + 2];
    if (
      next &&
      /^(–|—|-|to|through|thru)$/.test(next) &&
      after &&
      DAYS.includes(after.slice(0, 3))
    ) {
      const e = DAYS.indexOf(after.slice(0, 3));
      for (let k = d; ; k = (k + 1) % 7) {
        out.add(k + 1);
        if (k === e) break;
      }
      i += 2;
    } else out.add(d + 1);
  }
  return [...out].sort();
}

export function parseHours(prompt: string): BookingParams["hours"] {
  const hours: BookingParams["hours"] = [];
  const re = new RegExp(
    String.raw`((?:${DAY}\s*(?:–|—|-|to|through|thru|,|and|&)?\s*)+)[\s,:(]*(?:from\s+)?${TIME}\s*${DASH}\s*${TIME}`,
    "gi",
  );
  for (const m of prompt.matchAll(re)) {
    const days = parseDays(m[1] ?? "");
    const open = clock(m[2] ?? "", m[3], m[4]);
    const close = clock(m[5] ?? "", m[6], m[7] ?? m[4]);
    if (!open || !close || open >= close) continue;
    for (const weekday of days) hours.push({ weekday, open, close });
  }
  // "weekdays 9–18", "every day 10:00-22:00"
  const general = new RegExp(
    String.raw`\b(weekdays|every day|daily)\b[\s,:(]*(?:from\s+)?${TIME}\s*${DASH}\s*${TIME}`,
    "gi",
  );
  for (const m of prompt.matchAll(general)) {
    const open = clock(m[2] ?? "", m[3], m[4]);
    const close = clock(m[5] ?? "", m[6], m[7] ?? m[4]);
    if (!open || !close || open >= close) continue;
    const days = /weekdays/i.test(m[1] ?? "") ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7];
    for (const weekday of days)
      if (!hours.some((h) => h.weekday === weekday)) hours.push({ weekday, open, close });
  }
  return hours.sort((a, b) => a.weekday - b.weekday || a.open.localeCompare(b.open));
}

export function parseMoney(text: string): { price: number; currency: string } | null {
  const m =
    /(€|\$|£)\s*(\d+(?:[.,]\d{1,2})?)/.exec(text) ??
    /(\d+(?:[.,]\d{1,2})?)\s*(€|eur\b|euros?\b|\$|usd\b|dollars?\b|£|gbp\b|pounds?\b)/i.exec(text);
  if (!m) return null;
  const [amount, sym] = /\d/.test(m[1] ?? "") ? [m[1] ?? "", m[2] ?? ""] : [m[2] ?? "", m[1] ?? ""];
  const s = sym.toLowerCase();
  const currency =
    s.startsWith("€") || s.startsWith("eur")
      ? "EUR"
      : s === "$" || s.startsWith("usd") || s.startsWith("dollar")
        ? "USD"
        : "GBP";
  return { price: Number(amount.replace(",", ".")), currency };
}

/** Booking parameters from the request (deterministic). Null when the request is not about bookings. */
export function extractBookingParams(
  prompt: string,
  appName = "Our business",
): { params: BookingParams; assumptions: string[] } | null {
  const text = prompt.replace(/\s+/g, " ");
  if (!/\b(book(?:s|ing|ings|ed)?|appointments?|reservations?|reserve)\b/i.test(text)) return null;
  const assumptions: string[] = [];

  const business = (/[“"]([^”"]{2,60})[”"]/.exec(text)?.[1] ?? appName).trim();

  // Durations: "45-minute sessions", "30 min appointments", "1-hour classes".
  const durations = [
    ...text.matchAll(/\b(\d{1,3})\s*-?\s*(?:minutes?|mins?)\b(?:\s+([a-z]+))?/gi),
  ].map((m) => ({
    minutes: Number(m[1]),
    noun: m[2]?.toLowerCase(),
  }));
  const hourly =
    /\b(one|1|an?)\s*-?\s*hour\s+(sessions?|appointments?|classes|slots?|visits?)/i.exec(text);
  if (hourly) durations.push({ minutes: 60, noun: (hourly[2] ?? "").toLowerCase() });
  const minutes = durations.find((d) => d.minutes >= 5 && d.minutes <= 480)?.minutes ?? 30;
  if (!durations.length) assumptions.push("Appointment length not stated: 30 minutes.");
  const sessionNoun = durations.find(
    (d) =>
      d.noun &&
      /^(session|appointment|class|visit|slot|treatment|lesson|consultation)/.test(d.noun),
  )?.noun;

  // Team: "three physiotherapists", "4 stylists (Ana, Luis, Marta, Sol)".
  let resource: BookingParams["resource"] | null = null;
  for (const m of text.matchAll(
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([a-z][a-z-]{2,30}s)\b(\s*\(([^)]{2,200})\))?/gi,
  )) {
    const plural = (m[2] ?? "").toLowerCase();
    if (NOT_RESOURCES.has(plural)) continue;
    const count = num(m[1] ?? "");
    if (!Number.isInteger(count) || count < 1 || count > 50) continue;
    const names = (m[4] ?? "")
      .split(/,|\band\b|&/)
      .map((s) => s.trim())
      .filter((s) => /^[\p{Lu}][\p{L} .'-]{0,40}$/u.test(s))
      .slice(0, count);
    resource = { singular: cap(singular(plural)), plural: cap(plural), count, names };
    break;
  }
  if (!resource) {
    resource = { singular: "Staff member", plural: "Staff", count: 1, names: [] };
    assumptions.push("Team size not stated: one bookable person.");
  }

  const customerNoun =
    CUSTOMER_NOUNS.find((n) => new RegExp(`\\b${n}\\b`, "i").test(text)) ?? "customers";
  const customer = { singular: singular(customerNoun), plural: customerNoun };

  let hours = parseHours(text);
  if (hours.length === 0) {
    hours = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, open: "09:00", close: "17:00" }));
    assumptions.push("Opening hours not stated: Monday–Friday 09:00–17:00.");
  }

  let timeZone =
    [...text.matchAll(/\b([A-Z][A-Za-z_]+\/[A-Z][A-Za-z_]+(?:\/[A-Z][A-Za-z_]+)?)\b/g)]
      .map((m) => m[1] ?? "")
      .find(isTimeZone) ?? null;
  if (!timeZone) {
    const city = Object.keys(CITY_ZONES).find((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
    timeZone = city ? (CITY_ZONES[city] ?? "UTC") : "UTC";
    assumptions.push(
      city ? `Time zone inferred from "${city}": ${timeZone}.` : "Time zone not stated: UTC.",
    );
  }

  const notice =
    /\b(?:not later than|no later than|at least|up to|until|minimum(?: of)?)\s+(\d{1,3})\s*(hours?|h|days?)\s+(?:before|in advance|ahead|notice)/i.exec(
      text,
    ) ?? /\b(\d{1,3})\s*-?\s*(hours?|h|days?)['’]?\s*(?:notice|before|in advance)/i.exec(text);
  const cancelNoticeHours = notice
    ? Number(notice[1]) * (/^d/i.test(notice[2] ?? "") ? 24 : 1)
    : 24;
  if (!notice) assumptions.push("Change/cancellation notice not stated: 24 hours.");

  // Services and prices: "prices: first visit 60 €, follow-up 50 €".
  const services: BookingParams["services"] = [];
  const priceSegment =
    /\bprices?\b\s*(?:are|is)?\s*[:(]?\s*([^);.\n]+(?:\.\d{1,2}[^);.\n]*)?)/i.exec(text)?.[1];
  for (const part of (priceSegment ?? "").split(/,|\band\b/)) {
    const money = parseMoney(part);
    if (!money) continue;
    const name = part
      .replace(
        /(€|\$|£)\s*\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s*(€|eur\b|euros?\b|\$|usd\b|dollars?\b|£|gbp\b|pounds?\b)/gi,
        "",
      )
      .replace(/^[\s:–-]+|[\s:–-]+$/g, "")
      .replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 80) continue;
    services.push({ name: cap(name), minutes, price: money.price, currency: money.currency });
  }
  if (services.length === 0) {
    services.push({
      name: cap(sessionNoun ? singular(sessionNoun) : "Appointment"),
      minutes,
      price: null,
      currency: null,
    });
    assumptions.push("Prices not stated: none published.");
  }

  // Questions the assistant answers: "common questions (prices: …; address; what to bring)".
  const faq: BookingParams["faq"] = [];
  const questions = /\b(?:questions|faqs?)\b[^(]{0,40}\(([^)]{2,400})\)/i.exec(text)?.[1];
  for (const raw of (questions ?? "").split(/;/)) {
    const [topic, ...answer] = raw.split(":");
    const t = topic?.trim();
    if (!t || t.length < 2) continue;
    faq.push({ topic: cap(t).slice(0, 120), answer: answer.join(":").trim() || null });
  }

  const slotMinutes = Math.max(5, services.map((s) => s.minutes).reduce(gcd));
  // "a physiotherapy clinic", "our hair salon": the request's word for the business (criteria use it).
  const businessKind =
    /\b(?:a|an|our|the|my)\s+(?:[a-z-]+\s+){0,2}?(clinic|salon|studio|practice|spa|gym|barbershop|shop|office|centre|center|school|restaurant|garage|surgery|academy)\b/i
      .exec(text)?.[1]
      ?.toLowerCase() ?? null;
  const params = bookingParamsSchema.parse({
    business: business.slice(0, 80),
    businessKind,
    timeZone,
    resource,
    customer,
    services,
    slotMinutes,
    hours,
    policy: { cancelNoticeHours, bookingNoticeMinutes: 0, horizonDays: 60 },
    faq,
  });
  return { params, assumptions };
}

const BOOKING_ENTITIES = [
  "Booking",
  "Appointment",
  "Reservation",
  "Session",
  "Slot",
  "TimeSlot",
  "AvailabilitySlot",
  "Availability",
  "Schedule",
  "OpeningHour",
  "OpeningHours",
  "BusinessHour",
  "BusinessHours",
  "WorkingHour",
  "WorkingHours",
  "Service",
  "Price",
  "Faq",
  "Customer",
  "Client",
  "Staff",
  "StaffMember",
  "Resource",
  "Notification",
  "EmailNotification",
  "BookingNotification",
];

const pascal = (s: string) =>
  s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(cap)
    .join("");

/** Every domain detected in the request, for the given recipe. */
export function detectDomains(prompt: string, recipe: string, appName?: string): DomainSelection[] {
  const out: DomainSelection[] = [];
  if (recipe === "ai-agents") {
    const b = extractBookingParams(prompt, appName);
    if (b) {
      out.push({
        id: "bookings",
        capability: "domain.bookings",
        component: "domain.bookings.turbineh",
        recipes: ["ai-agents"],
        paramsFile: "src/bookings/params.json",
        params: b.params as unknown as Record<string, unknown>,
        providedEntities: [
          ...BOOKING_ENTITIES,
          pascal(b.params.resource.singular),
          pascal(b.params.customer.singular),
        ],
        assumptions: b.assumptions,
      });
    }
  }
  return out;
}
