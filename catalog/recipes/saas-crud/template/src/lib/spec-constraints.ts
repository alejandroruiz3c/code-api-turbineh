/**
 * Constraints stated in the request (ADR-0043): time zone, currency, limits, notice, opening hours, statuses, sort
 * order and page size. Base values are the documented defaults; TurbineH replaces this file with what the request
 * says (anything it does not say keeps the default and is listed in `ASSUMPTIONS`). Lists, forms, validation and
 * components read these values instead of hard-coding them.
 */
export const SPEC_CONSTRAINTS = {
  /** IANA time zone dates and times are shown and entered in. */
  timeZone: "UTC",
  /** ISO 4217 code of prices, or null when the app has none. */
  currency: null as string | null,
  /** Rows per page of every list. */
  pageSize: 20,
  /** Upload limits, or null when the app has no uploads. */
  uploads: null as { maxBytes: number; types: readonly string[]; private: boolean } | null,
  /** Minimum notice before a change or cancellation, in hours (null = none stated). */
  noticeHours: null as number | null,
  /** Opening hours per ISO weekday (1 = Monday). */
  openingHours: [] as readonly { weekday: number; open: string; close: string }[],
  /** Status lists the request names, per field ("status", "stage"). */
  statuses: {} as Readonly<Record<string, readonly string[]>>,
  /** Default sort orders the request names ("sorted by date, newest first"). */
  sort: [] as readonly { field: string; direction: "asc" | "desc" }[],
  /** Numbers the request states about the domain ("four stylists", "six shops"). */
  numbers: {} as Readonly<Record<string, number>>,
} as const;

/** Defaults used because the request did not say. */
export const ASSUMPTIONS: readonly string[] = ["Time zone not stated: UTC.", "Page size: 20."];
