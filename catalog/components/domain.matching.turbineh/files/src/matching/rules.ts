import { z } from "zod";
import { FEEDBACK, RECORD_STATUSES } from "./config";
import { parseTerms } from "./score";

/**
 * Input rules of the matching component (pure, unit-tested): what a profile and a record may contain. Server actions
 * and the service validate with these before anything is stored.
 */
const terms = z
  .string()
  .max(4000)
  .transform((s) => parseTerms(s));

export const profileInput = z.object({
  sectors: terms,
  activities: terms,
  regions: terms,
  keywords: terms,
});
export type ProfileInput = z.output<typeof profileInput>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === "" ? null : s));

/** Public http(s) links only (shown as a link to the record's source). */
const sourceUrl = z
  .string()
  .trim()
  .max(500)
  .refine((s) => s === "" || /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s), "Use an http(s) link.")
  .transform((s) => (s === "" ? null : s));

export const recordInput = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(1).max(10_000),
  sector: optionalText(120),
  activity: optionalText(120),
  region: optionalText(160),
  deadline: z
    .string()
    .trim()
    .refine((s) => s === "" || /^\d{4}-\d{2}-\d{2}$/.test(s), "Use a date (YYYY-MM-DD).")
    .transform((s) => (s === "" ? null : s)),
  sourceUrl,
  status: z.enum(RECORD_STATUSES),
});
export type RecordInput = z.output<typeof recordInput>;

export const feedbackInput = z.object({
  recordId: z.string().uuid(),
  verdict: z.enum(FEEDBACK),
});

/** List filters from the query string (text, sector, region, status, deadline on or before). */
export interface RecordFilters {
  q: string;
  sector: string;
  region: string;
  status: string;
  before: string;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseFilters(q: Record<string, string | string[] | undefined>): RecordFilters {
  const status = first(q.status);
  const before = first(q.before);
  return {
    q: first(q.q).trim().slice(0, 100),
    sector: first(q.sector).trim().slice(0, 120),
    region: first(q.region).trim().slice(0, 160),
    status: (RECORD_STATUSES as readonly string[]).includes(status) ? status : "",
    before: /^\d{4}-\d{2}-\d{2}$/.test(before) ? before : "",
  };
}

/** `%` and `_` typed by a person are literal characters in a LIKE pattern. */
export const likePattern = (s: string): string => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
