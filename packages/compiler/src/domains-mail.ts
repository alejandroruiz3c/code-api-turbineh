import { z } from "zod";

/**
 * Mailbox triage (component ai.mail-triage.turbineh, ADR-0072): detected and parameterised from the request by code.
 * A request is about triaging a mailbox when it reads the person's (or the team's) incoming mail and asks to classify,
 * prioritise, digest it or to pick invoices and payments out of it. Anything the request does not say is a documented
 * default (assumptions), never an invented fact.
 */
export const MAIL_CATEGORIES = [
  "action",
  "finance",
  "work",
  "personal",
  "newsletter",
  "promotion",
  "notification",
  "other",
] as const;
export const FINANCE_KINDS = ["income", "expense", "investment"] as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const mailTriageParamsSchema = z.object({
  /** Categories the classifier may use (closed list: the model's answer is validated against it). */
  categories: z
    .array(z.string().regex(/^[a-z][a-z-]{1,23}$/))
    .min(2)
    .max(16),
  finance: z.object({
    /** Invoices and payments are extracted to the finance ledger (and its Excel export). */
    enabled: z.boolean(),
    kinds: z.array(z.enum(FINANCE_KINDS)).min(1),
    /** Shown when an email states no currency symbol or code; extracted amounts keep their own currency. */
    defaultCurrency: z.string().regex(/^[A-Z]{3}$/),
  }),
  digest: z.object({
    enabled: z.boolean(),
    /** Local time of the daily digest in `timeZone`. */
    at: hhmm,
    timeZone: z.string().min(1),
    /** Lowest priority included in the digest. */
    minPriority: z.enum(["urgent", "high", "normal"]),
    max: z.number().int().min(1).max(50),
  }),
  /** Minutes between two inbox synchronisations (scheduled job). */
  syncEveryMinutes: z.number().int().min(5).max(1440),
});
export type MailTriageParams = z.infer<typeof mailTriageParamsSchema>;

const MAILBOX =
  /\b(?:my|our|the|their|his|her|incoming|received|unread|new)\s+(?:e-?mails?|mails?|inbox(?:es)?|mailbox(?:es)?)\b|\b(?:e-?mails?|mails?)\s+(?:i|we|they|you)\s+(?:receive|received|get|got)\b|\binbox(?:es)?\b|\bmailbox(?:es)?\b|\b(?:access|read|connect(?:s|ed)? to|go through|scan)\s+(?:my\s+|our\s+|the\s+)?(?:e-?mails?|mail)\b/i;
const TRIAGE =
  /\b(?:classif\w*|categori[sz]\w*|prioriti[sz]\w*|priority|triage\w*|sort\w*|label\w*|digest|(?:daily|morning|weekly) (?:update|summary|report|email|e-mail)|invoices?|payments?|receipts?|bills?)\b/i;
const FINANCE =
  /\b(?:invoices?|payments?|receipts?|bills?|expens\w*|incomes?|inversions?|investments?|financ\w*|ledger|excel|spreadsheet|xlsx|accounting|bookkeeping)\b/i;
const DIGEST =
  /\b(?:daily|every (?:day|morning)|each (?:day|morning)|morning)\b[^.]{0,80}\b(?:update|summary|digest|report|e-?mail|list)\b|\b(?:digest|summary|update)\b[^.]{0,40}\b(?:daily|every (?:day|morning)|each (?:day|morning))\b/i;

/** True when the request asks to triage a mailbox (read it and classify, prioritise, digest or extract from it). */
export function isMailTriage(prompt: string): boolean {
  // Both in one sentence: "sends a confirmation email" and "takes payments" elsewhere never make a mailbox triage.
  return prompt
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;])\s+/)
    .some((sentence) => MAILBOX.test(sentence) && TRIAGE.test(sentence));
}

const CURRENCIES: [RegExp, string][] = [
  [/€|\beur\b|\beuros?\b/i, "EUR"],
  [/£|\bgbp\b|\bpounds?\b/i, "GBP"],
  [/\$|\busd\b|\bdollars?\b/i, "USD"],
  [/\bchf\b|\bswiss francs?\b/i, "CHF"],
  [/\bmxn\b|\bpesos?\b/i, "MXN"],
];

/** "at 7am", "at 08:30", "by 9 in the morning" next to the digest words; null when not stated. */
function digestTime(text: string): string | null {
  const m =
    /\b(?:at|by|around)\s+(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?!\s*(?:%|€|\$|£))/i.exec(
      text,
    );
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  const ampm = (m[3] ?? "").toLowerCase().replace(/\./g, "");
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Parameters of the mailbox triage from the request (deterministic), or null when it is not about a mailbox. */
export function extractMailTriageParams(
  prompt: string,
  zones: { isTimeZone: (tz: string) => boolean; cities: Record<string, string> },
): { params: MailTriageParams; assumptions: string[] } | null {
  const text = prompt.replace(/\s+/g, " ");
  if (!isMailTriage(text)) return null;
  const assumptions: string[] = [];
  const finance = FINANCE.test(text);
  const currency = CURRENCIES.find(([re]) => re.test(text))?.[1];
  if (finance && !currency)
    assumptions.push(
      "Currency not stated: amounts keep the currency each email states; EUR when it states none.",
    );
  const digest = DIGEST.test(text);
  const at = digestTime(text);
  if (digest && !at) assumptions.push("Digest time not stated: every day at 07:00.");
  let timeZone =
    [...text.matchAll(/\b([A-Z][A-Za-z_]+\/[A-Z][A-Za-z_]+(?:\/[A-Z][A-Za-z_]+)?)\b/g)]
      .map((m) => m[1] ?? "")
      .find(zones.isTimeZone) ?? null;
  if (!timeZone) {
    const city = Object.keys(zones.cities).find((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
    timeZone = city ? (zones.cities[city] ?? "UTC") : "UTC";
    if (digest)
      assumptions.push(
        city ? `Time zone inferred from "${city}": ${timeZone}.` : "Time zone not stated: UTC.",
      );
  }
  assumptions.push(
    "Mailbox read over IMAP with an app password or an OAuth access token (MAIL_IMAP_*), read-only.",
  );
  const params = mailTriageParamsSchema.parse({
    categories: [...MAIL_CATEGORIES],
    finance: { enabled: finance, kinds: [...FINANCE_KINDS], defaultCurrency: currency ?? "EUR" },
    digest: { enabled: true, at: at ?? "07:00", timeZone, minPriority: "high", max: 15 },
    syncEveryMinutes: 15,
  });
  return { params, assumptions };
}

/** The scheduled jobs of a mailbox triage (component jobs.scheduled.turbineh): sync, then the daily digest. */
export function mailJobs(params: MailTriageParams): Record<string, unknown> {
  const [h, m] = params.digest.at.split(":").map(Number);
  return {
    jobs: [
      {
        id: "mail-sync",
        kind: "custom",
        cron: `*/${Math.min(params.syncEveryMinutes, 59)} * * * *`,
        timeZone: params.digest.timeZone,
        what: "Read new emails from the mailbox and classify them",
      },
      {
        id: "mail-digest",
        kind: "daily-digest",
        cron: `${m ?? 0} ${h ?? 7} * * *`,
        timeZone: params.digest.timeZone,
        what: "Email the most important emails that need attention",
      },
    ],
    logWhenNoEmailProvider: true,
  };
}

/** Entities the mailbox triage implements (the generic CRUD generator never duplicates them). */
export const MAIL_ENTITIES = [
  "Email",
  "Mail",
  "EmailMessage",
  "MailMessage",
  "InboxMessage",
  "Inbox",
  "Mailbox",
  "Classification",
  "EmailClassification",
  "Category",
  "Priority",
  "Digest",
  "DailyDigest",
  "DailyUpdate",
  "Summary",
  "FinancialRecord",
  "FinanceRecord",
  "FinanceEntry",
  "FinancialEntry",
  "Transaction",
  "Invoice",
  "Payment",
  "Receipt",
  "Income",
  "Expense",
  "Investment",
  "Ledger",
  "Spreadsheet",
  "ExcelFile",
  "ExcelRow",
];
