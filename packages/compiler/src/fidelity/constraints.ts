import { CITY_ZONES, isTimeZone, parseHours, parseMoney } from "../domains.js";
import { listItems, NUMBER_WORDS, sentences, singular, toNumber } from "./text.js";

/**
 * Constraints stated in the request (ADR-0040 §3), extracted by code: file limits, durations, notice periods, opening
 * hours, time zone (IANA), currency, page size, sort orders, status lists, email domains, schedules and stated
 * numbers. They are passed as parameters to components and to generated entities (status lists become enum options,
 * the time zone and limits land in `src/lib/spec-constraints.ts`). Anything the request does not say is a documented
 * default (`assumptions`), never an invented fact.
 */
export interface StatusList {
  /** "status" or "stage" (the field it applies to). */
  field: string;
  values: string[];
  /** The noun the list belongs to when the request says ("pieces", "document requests"), else null. */
  of: string | null;
  source: string;
}

export interface Schedule {
  /** What runs (the clause of the request). */
  what: string;
  /** Five-field cron expression, in `timeZone`. */
  cron: string;
  timeZone: string;
}

export interface Constraints {
  timeZone: { value: string; source: "stated" | "city" | "default" };
  currency: string | null;
  uploads: {
    maxBytes: number | null;
    /** MIME types. */
    types: string[];
    extensions: string[];
    private: boolean;
  } | null;
  durations: { label: string; minutes: number }[];
  notice: { hours: number; about: string } | null;
  openingHours: { weekday: number; open: string; close: string }[];
  pageSize: number | null;
  sort: { field: string; direction: "asc" | "desc" }[];
  statusLists: StatusList[];
  emailDomains: string[];
  schedules: Schedule[];
  /** Numbers the request states about the domain ("four stylists", "up by five positions"). */
  numbers: { what: string; value: number }[];
  prices: { name: string; minutes: number | null; price: number; currency: string }[];
  assumptions: string[];
}

const FILE_TYPES: Record<string, { mime: string; ext: string[] }> = {
  pdf: { mime: "application/pdf", ext: ["pdf"] },
  jpg: { mime: "image/jpeg", ext: ["jpg", "jpeg"] },
  jpeg: { mime: "image/jpeg", ext: ["jpg", "jpeg"] },
  png: { mime: "image/png", ext: ["png"] },
  gif: { mime: "image/gif", ext: ["gif"] },
  webp: { mime: "image/webp", ext: ["webp"] },
  heic: { mime: "image/heic", ext: ["heic"] },
  csv: { mime: "text/csv", ext: ["csv"] },
  txt: { mime: "text/plain", ext: ["txt"] },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: ["docx"],
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: ["xlsx"],
  },
  zip: { mime: "application/zip", ext: ["zip"] },
};
const UNIT_BYTES: Record<string, number> = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

const NOT_COUNTED = new Set([
  "minutes",
  "minute",
  "hours",
  "hour",
  "days",
  "day",
  "weeks",
  "months",
  "years",
  "seconds",
  "times",
  "mb",
  "kb",
  "gb",
  "percent",
  "euros",
  "dollars",
  "pounds",
  "rows",
  "items",
]);

const SCHEDULES: { re: RegExp; cron: string }[] = [
  { re: /\bevery (?:weekday )?morning\b|\beach morning\b/i, cron: "0 7 * * *" },
  { re: /\bevery (?:night|evening)\b|\bnightly\b/i, cron: "0 20 * * *" },
  { re: /\bevery hour\b|\bhourly\b/i, cron: "0 * * * *" },
  { re: /\bevery (?:week|monday)\b|\bweekly\b/i, cron: "0 7 * * 1" },
  { re: /\bevery month\b|\bmonthly\b/i, cron: "0 7 1 * *" },
  // "daily" schedules something ("a daily digest", "runs daily") but not data ("daily sales", "daily totals").
  {
    re: /\b(?:every day|each day)\b(?!\s*(?:from\s+)?\d)|\bdaily\b(?=\s*(?:[.,;)]|$|(?:digest|reports?|e-?mails?|summary|summaries|reminders?|jobs?|backups?|exports?|at\b)))/i,
    cron: "0 7 * * *",
  },
];

/** Extracts the request's constraints (deterministic). */
export function extractConstraints(prompt: string): Constraints {
  const text = prompt.replace(/\s+/g, " ");
  const all = sentences(text);
  const assumptions: string[] = [];

  // Time zone: an IANA name, else a known city, else UTC (documented).
  const iana = [...text.matchAll(/\b([A-Z][A-Za-z_]+\/[A-Z][A-Za-z_]+(?:\/[A-Z][A-Za-z_]+)?)\b/g)]
    .map((m) => m[1] ?? "")
    .find(isTimeZone);
  const city = iana
    ? null
    : Object.keys(CITY_ZONES).find((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
  const timeZone = iana
    ? { value: iana, source: "stated" as const }
    : city
      ? { value: CITY_ZONES[city] ?? "UTC", source: "city" as const }
      : { value: "UTC", source: "default" as const };
  if (timeZone.source === "default") assumptions.push("Time zone not stated: UTC.");
  if (timeZone.source === "city")
    assumptions.push(`Time zone inferred from "${city}": ${timeZone.value}.`);

  // Prices and currency.
  const prices: Constraints["prices"] = [];
  for (const m of text.matchAll(
    /(?:^|[,:;]\s*|\band\s+)([A-Za-z][A-Za-z' -]{1,40}?)\s+(\d{1,3})\s*(?:min|minutes?)\b\s*\(\s*([€$£])?\s*(\d+(?:[.,]\d{1,2})?)\s*([€$£]|eur|usd|gbp)?\s*\)/gi,
  )) {
    const money = parseMoney(`${m[3] ?? ""}${m[4] ?? ""}${m[5] ?? ""}`);
    if (!money) continue;
    const name = (m[1] ?? "").replace(/^(services?|prices?)\s*:?\s*/i, "").trim();
    if (name.length < 2) continue;
    prices.push({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      minutes: Number(m[2]),
      ...money,
    });
  }
  const currency = prices[0]?.currency ?? parseMoney(text)?.currency ?? null;

  // Uploads: size and types.
  let uploads: Constraints["uploads"] = null;
  if (/\b(upload\w*|attach\w*|files?)\b/i.test(text)) {
    const size =
      /\b(?:up to|max(?:imum)?(?: of)?|at most|no (?:more|larger|bigger) than|≤|under)\s*(\d+(?:\.\d+)?)\s*(kb|mb|gb)\b|\b(\d+(?:\.\d+)?)\s*(kb|mb|gb)\s*(?:max|limit|maximum)\b/i.exec(
        text,
      );
    const types = new Set<string>();
    const extensions = new Set<string>();
    const typeList =
      /\b((?:pdf|jpe?g|png|gif|webp|heic|csv|txt|docx|xlsx|zip)(?:\s*(?:\/|,|or|and)\s*(?:pdf|jpe?g|png|gif|webp|heic|csv|txt|docx|xlsx|zip))+)\b/i.exec(
        text,
      );
    for (const t of (typeList?.[1] ?? "").toLowerCase().split(/\s*(?:\/|,|or|and)\s*/)) {
      const ft = FILE_TYPES[t];
      if (!ft) continue;
      types.add(ft.mime);
      for (const e of ft.ext) extensions.add(e);
    }
    const maxBytes = size
      ? Math.round(
          Number(size[1] ?? size[3]) *
            (UNIT_BYTES[(size[2] ?? size[4] ?? "mb").toLowerCase()] ?? 1),
        )
      : null;
    if (size || types.size > 0 || /\b(upload\w*|attachments?)\b/i.test(text)) {
      uploads = {
        maxBytes,
        types: [...types],
        extensions: [...extensions],
        private:
          /\bprivate(ly)?\b|\bonly (?:by|to)\b[^.]{0,40}\b(download|see|access)|downloadable only/i.test(
            text,
          ),
      };
      if (maxBytes === null) assumptions.push("Upload size limit not stated: 10 MB.");
      if (types.size === 0) assumptions.push("Upload types not stated: PDF, JPEG and PNG.");
    }
  }

  // Durations ("cut 30 min", "45-minute sessions", "1-hour classes").
  const durations: Constraints["durations"] = [];
  for (const p of prices) if (p.minutes) durations.push({ label: p.name, minutes: p.minutes });
  for (const m of text.matchAll(/\b(\d{1,3})\s*-?\s*(?:minutes?|mins?|min)\b(?:\s+([a-z]+))?/gi)) {
    const minutes = Number(m[1]);
    if (minutes < 5 || minutes > 480 || durations.some((d) => d.minutes === minutes)) continue;
    durations.push({ label: (m[2] ?? "").toLowerCase() || "duration", minutes });
  }

  // Notice periods ("cancel up to 12 hours before", "24 hours' notice").
  const notice =
    /\b(cancel\w*|change\w*|reschedul\w*|book\w*|modif\w*)?[^.;]{0,40}?\b(?:not later than|no later than|at least|up to|until|minimum(?: of)?)\s+(\d{1,3})\s*(hours?|h|days?)\s+(?:before|in advance|ahead|notice)/i.exec(
      text,
    ) ?? /\b()(\d{1,3})\s*-?\s*(hours?|h|days?)['’]?\s*(?:notice|before|in advance)/i.exec(text);
  const noticeOut = notice
    ? {
        hours: Number(notice[2]) * (/^d/i.test(notice[3] ?? "") ? 24 : 1),
        about: (notice[1] ?? "").toLowerCase().replace(/\W.*$/, "") || "change",
      }
    : null;

  // Pagination and sort orders.
  const page =
    /\b(\d{1,3})\s*(?:items?|rows?|records?|results?|entries|[a-z]+s)?\s*per page\b/i.exec(text);
  const pageSize = page ? Number(page[1]) : null;
  if (!pageSize && /\bpaginat/i.test(text)) assumptions.push("Page size not stated: 20 per page.");
  const sort: Constraints["sort"] = [];
  for (const m of text.matchAll(
    /\b(?:sort(?:ed|ing)?|order(?:ed)?)\s+by\s+((?:due |interview |start |end |creation |created |publication )?[a-z]+)(?:\s*\((newest|latest|oldest|earliest|ascending|descending)[^)]*\)|\s+(newest|latest|oldest|earliest|ascending|descending))?/gi,
  )) {
    const field = (m[1] ?? "").toLowerCase();
    const dir = (m[2] ?? m[3] ?? "").toLowerCase();
    const direction: "asc" | "desc" = /oldest|earliest|ascending/.test(dir)
      ? "asc"
      : /newest|latest|descending/.test(dir) || /date|time|created|at$/.test(field)
        ? "desc"
        : "asc";
    if (!dir)
      assumptions.push(
        `Sort direction for "${field}" not stated: ${direction === "desc" ? "newest first" : "A to Z"}.`,
      );
    sort.push({ field, direction });
  }

  // Status lists ("statuses (pending, received, approved)", "goes through stages (thrown, …, sold)").
  const statusLists: StatusList[] = [];
  for (const s of all) {
    for (const m of s.matchAll(
      /\b(status(?:es)?|stages?|states?|steps?)\s*(?:\(([^)]{3,200})\)|:\s*([^.;]{3,200}))/gi,
    )) {
      const values = listItems(m[2] ?? m[3] ?? "")
        .map((v) =>
          v
            .toLowerCase()
            .replace(/[^a-z0-9 _-]/g, "")
            .trim(),
        )
        .filter((v) => v && v.split(" ").length <= 3);
      if (values.length < 2) continue;
      const before = s.slice(0, m.index ?? 0);
      const of =
        /\b(?:each|every|the)?\s*([a-z]+(?:\s+[a-z]+)?)\s+(?:goes|go|move|moves|pass|passes|has|have|with)\b[^.;]*$/i.exec(
          before,
        )?.[1] ??
        /\b([a-z]+(?:\s+[a-z]+)?)\s+(?:with|and)\s+(?:due dates and\s+)?$/i.exec(before)?.[1] ??
        null;
      statusLists.push({
        field: singular((m[1] ?? "status").toLowerCase()).replace(/statu$/, "status"),
        values,
        of: of ? of.toLowerCase().replace(/^(a|an|the|each|every)\s+/, "") : null,
        source: s,
      });
    }
  }

  const emailDomains = [
    ...new Set(
      [...text.matchAll(/(?:^|[\s(])@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)].map((m) =>
        (m[1] ?? "").toLowerCase(),
      ),
    ),
  ];

  // Schedules ("every morning", "daily", "weekly").
  const schedules: Schedule[] = [];
  for (const s of all) {
    for (const { re, cron } of SCHEDULES) {
      if (!re.test(s)) continue;
      const clause =
        s.split(/,|;|\band\b(?=\s+(?:a|an|the|every|each)\b)/).find((c) => re.test(c)) ?? s;
      schedules.push({
        what: clause.trim().replace(/\s*\(.*$/, ""),
        cron,
        timeZone: timeZone.value,
      });
      break;
    }
  }
  if (schedules.length > 0 && !/\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\bat \d{1,2}:\d{2}/i.test(text))
    assumptions.push(
      "Time of scheduled jobs not stated: 07:00 (mornings and daily), 20:00 (evenings).",
    );

  // Stated numbers ("four stylists", "six coffee shops", "up by five positions").
  const numbers: Constraints["numbers"] = [];
  const NUM = `(\\d{1,4}|${Object.keys(NUMBER_WORDS).join("|")})`;
  for (const m of text.matchAll(new RegExp(`\\b${NUM}\\s+((?:[a-z]+\\s+)?[a-z]+s)\\b`, "gi"))) {
    const what = (m[2] ?? "").toLowerCase();
    const last = what.split(" ").pop() ?? "";
    if (NOT_COUNTED.has(last) || /^(in|of|by|per|to|at)\s/.test(what)) continue;
    const value = toNumber(m[1] ?? "");
    if (!Number.isFinite(value)) continue;
    numbers.push({ what, value });
  }
  for (const m of text.matchAll(
    new RegExp(`\\bby\\s+${NUM}\\s+(positions?|places?|spots?)\\b`, "gi"),
  )) {
    numbers.push({ what: `move up by ${m[2]}`, value: toNumber(m[1] ?? "") });
  }

  return {
    timeZone,
    currency,
    uploads,
    durations,
    notice: noticeOut,
    openingHours: parseHours(text),
    pageSize,
    sort,
    statusLists,
    emailDomains,
    schedules,
    numbers,
    prices,
    assumptions,
  };
}
