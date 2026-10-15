/**
 * CSV export/import without dependencies (components data.csv-export.turbineh / data.csv-import.turbineh).
 * Export neutralises spreadsheet formula injection; import is bounded in size and rows.
 */
const FORMULA = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  let s =
    value === null || value === undefined
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return (
    [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") +
    "\r\n"
  );
}

export const CSV_LIMITS = { maxBytes: 1_000_000, maxRows: 1_000 } as const;

/**
 * Largest CSV export. An export is never silently cut (ADR-0054): above this many rows it is refused with a message
 * asking to narrow the filters, so a downloaded file always holds the whole filtered list.
 */
export const EXPORT_MAX_ROWS = 50_000;

/** The explicit refusal of an export that would exceed EXPORT_MAX_ROWS. */
export function exportTooLarge(max: number = EXPORT_MAX_ROWS): Response {
  return new Response(
    `This export has more than ${max.toLocaleString("en-US")} rows. Narrow the filters (search, tag, dates) and export again.`,
    {
      status: 413,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    },
  );
}

/** RFC 4180 parser returning objects keyed by the header row. */
export function parseCsv(
  text: string,
  limits: { maxBytes: number; maxRows: number } = CSV_LIMITS,
): Record<string, string>[] {
  if (text.length > limits.maxBytes) throw new Error("CSV file is too large");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      if (rows.length > limits.maxRows + 1) throw new Error("CSV file has too many rows");
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  const [header, ...data] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
