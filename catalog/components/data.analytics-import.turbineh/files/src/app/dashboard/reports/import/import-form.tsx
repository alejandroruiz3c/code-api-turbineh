"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { importAnalyticsCsv, type ImportState } from "./actions";

/** CSV upload with the validation report: line, column and reason for every invalid row. */
export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importAnalyticsCsv, null);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-wrap items-end gap-3" aria-label="Import CSV">
        <div className="flex flex-col gap-1">
          <label htmlFor="csv-file" className="text-sm font-medium text-muted">
            CSV file
          </label>
          <input
            id="csv-file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="text-sm"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Import"}
        </Button>
      </form>
      {state ? (
        <p role="status" className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      ) : null}
      {state && !state.ok && state.errors.length ? (
        <table className="w-full text-left text-sm" data-testid="import-report">
          <caption className="mb-2 text-left text-muted">
            {state.total > state.errors.length
              ? `First ${state.errors.length} of ${state.total} problems`
              : "Problems"}
          </caption>
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="px-2 py-1 font-medium">Line</th>
              <th className="px-2 py-1 font-medium">Column</th>
              <th className="px-2 py-1 font-medium">Problem</th>
            </tr>
          </thead>
          <tbody>
            {state.errors.map((e, i) => (
              <tr key={`${e.line}-${e.column}-${i}`} className="border-b border-line">
                <td className="px-2 py-1">{e.line}</td>
                <td className="px-2 py-1">{e.column}</td>
                <td className="px-2 py-1">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
