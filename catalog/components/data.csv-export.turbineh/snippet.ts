// An export route in the app (e.g. src/app/dashboard/contacts/export/route.ts).
import { EXPORT_MAX_ROWS, exportTooLarge, toCsv } from "@/lib/csv";

export function contactsCsv(rows: { id: number; name: string }[]): Response {
  if (rows.length > EXPORT_MAX_ROWS) return exportTooLarge(); // refused, never silently cut
  // "=HACK" is written as "'=HACK": spreadsheet formula injection is neutralised.
  const csv = toCsv(rows, ["id", "name"]);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8" } });
}

export const sample = contactsCsv([
  { id: 1, name: "=HACK" },
  { id: 2, name: "Normal" },
]);
