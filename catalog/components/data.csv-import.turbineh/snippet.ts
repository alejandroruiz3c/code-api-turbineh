// An import action in the app (e.g. src/app/dashboard/contacts/import/actions.ts).
import { CSV_LIMITS, parseCsv } from "@/lib/csv";

export function importPeople(text: string): { name: string; age: number }[] {
  // Bounded: throws on files over CSV_LIMITS.maxBytes / maxRows.
  const rows = parseCsv(text, CSV_LIMITS);
  return rows.map((r) => ({ name: r.name ?? "", age: Number(r.age ?? 0) }));
}

export const people = importPeople("name,age\nAlice,30\nBob,25"); // → [{ name: "Alice", age: 30 }, …]
