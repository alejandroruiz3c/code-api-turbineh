/**
 * Constraints stated in the request (ADR-0043): time zone, currency, limits, notice, opening hours, statuses, sort
 * order and page size. Base values are the documented defaults; TurbineH replaces this file with what the request
 * says (anything it does not say keeps the default and is listed in `ASSUMPTIONS`). Lists, forms, validation and
 * components read these values instead of hard-coding them.
 */
export interface SpecConstraints {
  /** IANA time zone dates and times are shown and entered in. */
  timeZone: string;
  /** ISO 4217 code of prices, or null when the app has none. */
  currency: string | null;
  /** Rows per page of every list. */
  pageSize: number;
  /** Upload limits, or null when the app has no uploads. */
  uploads: { maxBytes: number; types: readonly string[]; private: boolean } | null;
  /** Minimum notice before a change or cancellation, in hours (null = none stated). */
  noticeHours: number | null;
  /** Opening hours per ISO weekday (1 = Monday). */
  openingHours: readonly { weekday: number; open: string; close: string }[];
  /** Status lists the request names, per field ("status", "stage"). */
  statuses: Readonly<Record<string, readonly string[]>>;
  /** Default sort orders the request names ("sorted by date, newest first"). */
  sort: readonly { field: string; direction: "asc" | "desc" }[];
  /** Scheduled jobs the request names (five-field cron in `timeZone`). */
  schedules: readonly { what: string; cron: string; timeZone: string }[];
  /** Email domains the request names ("company emails only (@acme.test)"). */
  emailDomains: readonly string[];
  /** Numbers the request states about the domain ("four stylists", "six shops"). */
  numbers: Readonly<Record<string, number>>;
}

export const SPEC_CONSTRAINTS: SpecConstraints = {
  timeZone: "UTC",
  currency: null,
  pageSize: 20,
  uploads: null,
  noticeHours: null,
  openingHours: [],
  statuses: {},
  sort: [],
  schedules: [],
  emailDomains: [],
  numbers: {},
};

/** Defaults used because the request did not say. */
export const ASSUMPTIONS: readonly string[] = ["Time zone not stated: UTC.", "Page size: 20."];
