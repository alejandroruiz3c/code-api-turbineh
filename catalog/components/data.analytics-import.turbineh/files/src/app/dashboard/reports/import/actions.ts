"use server";
import { revalidatePath } from "next/cache";
import { IMPORT_LIMITS, type RowError } from "@/analytics-import/rules";
import { importCsv } from "@/analytics-import/service";
import { toUserMessage } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { requireMember } from "@/server/authz";

/** CSV import (data.analytics-import.turbineh): the whole file or nothing, with a report of every invalid row. */
export type ImportState =
  | { ok: true; message: string }
  | { ok: false; message: string; errors: RowError[]; total: number }
  | null;

export async function importAnalyticsCsv(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const ctx = await requireMember();
  if (!(await rateLimit(`analytics:import:${ctx.userId}`, 10)))
    return { ok: false, message: "Too many imports. Try again in a minute.", errors: [], total: 0 };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, message: "Choose a CSV file.", errors: [], total: 0 };
  if (file.size > IMPORT_LIMITS.maxBytes)
    return { ok: false, message: "CSV files can be up to 5 MB.", errors: [], total: 0 };
  try {
    const r = await importCsv(ctx, file.name, await file.text());
    if (!r.ok)
      return {
        ok: false,
        message: `Nothing was imported: ${r.errors.length} problem${r.errors.length === 1 ? "" : "s"} found. Fix the file and import it again.`,
        errors: r.errors.slice(0, IMPORT_LIMITS.maxReport),
        total: r.errors.length,
      };
    revalidatePath("/dashboard/reports", "layout");
    return { ok: true, message: `Imported ${r.rows} rows from ${file.name}.` };
  } catch (err) {
    return { ok: false, message: toUserMessage(err), errors: [], total: 0 };
  }
}
