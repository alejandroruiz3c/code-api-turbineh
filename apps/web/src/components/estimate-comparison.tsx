import type { EstimateVsActual } from "@turbineh/shared";
import { comparisonRows, estimateView } from "@/lib/estimate-format";

/** Estimated (plan) vs real (this run) for a finished flow (F-06, ADR-0066). Persisted values only. */
export function EstimateComparison({ data }: { data: EstimateVsActual }) {
  const rows = comparisonRows(data);
  return (
    <section aria-label="Estimated vs real" className="rounded-xl border border-line p-4">
      <p className="text-sm font-semibold text-cream">Estimated vs real</p>
      <p className="mt-1 text-[11px] text-muted">
        Plan estimate: {estimateView(data.estimate).basis} Real: measured on this run.
      </p>
      <table className="mt-3 w-full text-left text-sm">
        <thead className="text-[11px] text-muted">
          <tr>
            <th className="py-1 font-normal"> </th>
            <th className="py-1 font-normal">Estimated</th>
            <th className="py-1 font-normal">Real</th>
            <th className="py-1 font-normal"> </th>
          </tr>
        </thead>
        <tbody className="text-ice-2">
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-line/50">
              <td className="py-1 text-muted">{r.label}</td>
              <td className="py-1">{r.estimated}</td>
              <td className="py-1 text-cream">{r.actual}</td>
              <td className="py-1 text-[11px] text-muted">
                {r.deviation ?? ""}
                {r.withinP90 === false ? " · above the 90th percentile" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
