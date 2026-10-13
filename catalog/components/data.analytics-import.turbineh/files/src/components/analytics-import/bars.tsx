/**
 * Accessible horizontal bars (component data.analytics-import.turbineh): the exact numbers are in a table next to the
 * bars, so screen readers and the CSV export read the same values.
 */
export function Bars({
  rows,
  caption,
  measure,
  testId,
}: {
  rows: { label: string; value: number }[];
  caption: string;
  measure: string;
  testId: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <table className="w-full text-left text-sm" data-testid={testId}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line text-muted">
          <th className="px-2 py-1 font-medium">{caption}</th>
          <th className="px-2 py-1 font-medium">{measure}</th>
          <th className="w-1/2 px-2 py-1" aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-b border-line">
            <th scope="row" className="px-2 py-1 font-normal">
              {r.label}
            </th>
            <td className="px-2 py-1 font-medium">
              {r.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </td>
            <td className="px-2 py-1" aria-hidden="true">
              <div className="h-2 rounded bg-subtle">
                <div
                  className="h-2 rounded bg-brand"
                  style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
