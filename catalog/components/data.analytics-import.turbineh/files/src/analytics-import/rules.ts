import type { Dataset, Period } from "./config";

/**
 * Pure rules of the analytics import (component data.analytics-import.turbineh), unit-tested in
 * tests/unit/analytics-import.test.ts: CSV parsing, all-or-nothing validation with a report, periods and comparisons.
 */
export const IMPORT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 50_000,
  maxReport: 200,
} as const;

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF; a trailing empty line is ignored. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export interface RowError {
  /** 1-based line of the file (the header is line 1). */
  line: number;
  column: string;
  message: string;
}

export interface ParsedRow {
  date: string;
  dimensions: Record<string, string>;
  measures: Record<string, number>;
}

const isDay = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * Validates a whole file against the dataset: header, every row's date, numbers and required text, and the scope
 * column against `allowedScopes` (names, lowercase) when given. Returns either every row or every error — never both.
 */
export function validateCsv(
  text: string,
  ds: Dataset,
  allowedScopes: Set<string> | "all" = "all",
): { rows: ParsedRow[]; errors: RowError[] } {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_"),
  );
  const missing = ds.columns.filter((c) => !header.includes(c));
  if (table.length === 0 || missing.length)
    return {
      rows: [],
      errors: [
        {
          line: 1,
          column: missing.join(", ") || "header",
          message: `Missing column(s): ${missing.join(", ") || ds.columns.join(", ")}`,
        },
      ],
    };
  if (table.length - 1 > IMPORT_LIMITS.maxRows)
    return {
      rows: [],
      errors: [{ line: 1, column: "", message: `At most ${IMPORT_LIMITS.maxRows} rows per file.` }],
    };
  const at = (cells: string[], c: string) => (cells[header.indexOf(c)] ?? "").trim();
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const date = at(cells, ds.date);
    if (!isDay(date))
      errors.push({ line, column: ds.date, message: `"${date}" is not a date (YYYY-MM-DD)` });
    const measures: Record<string, number> = {};
    for (const m of ds.measures) {
      const raw = at(cells, m);
      const n = Number(raw);
      if (raw === "" || !Number.isFinite(n))
        errors.push({ line, column: m, message: `"${raw}" is not a number` });
      else if (n < 0) errors.push({ line, column: m, message: "must not be negative" });
      else measures[m] = n;
    }
    const dimensions: Record<string, string> = {};
    for (const d of ds.dimensions) {
      const v = at(cells, d);
      if (!v) errors.push({ line, column: d, message: "is empty" });
      else if (v.length > 120)
        errors.push({ line, column: d, message: "is longer than 120 characters" });
      else dimensions[d] = v;
    }
    if (
      ds.scope &&
      allowedScopes !== "all" &&
      dimensions[ds.scope] &&
      !allowedScopes.has(dimensions[ds.scope]!.toLowerCase())
    )
      errors.push({
        line,
        column: ds.scope,
        message: `"${dimensions[ds.scope]}" is not one of your ${ds.scope} values`,
      });
    rows.push({ date, dimensions, measures });
  });
  return errors.length ? { rows: [], errors } : { rows, errors: [] };
}

/** First day of the period containing `day` (weeks start on Monday). */
export function periodStart(day: string, period: Period): string {
  const d = new Date(`${day}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (period === "day") return day;
  if (period === "week") {
    const wd = (d.getUTCDay() + 6) % 7;
    return iso(new Date(Date.UTC(y, m, d.getUTCDate() - wd)));
  }
  if (period === "month") return iso(new Date(Date.UTC(y, m, 1)));
  if (period === "quarter") return iso(new Date(Date.UTC(y, m - (m % 3), 1)));
  return iso(new Date(Date.UTC(y, 0, 1)));
}

/** The range of equal length just before [from, to] (inclusive days). */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  const days = Math.round((b - a) / 86_400_000) + 1;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: iso(a - days * 86_400_000), to: iso(a - 86_400_000) };
}

/** Change from `before` to `now` in percent (null when there was nothing before). */
export function change(now: number, before: number): number | null {
  if (before === 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}
