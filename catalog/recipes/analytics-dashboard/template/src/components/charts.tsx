import { fmt } from "@/server/analytics";

/**
 * Accessible SVG charts without dependencies: role="img" with a text summary, plus the exact numbers in a visually
 * hidden table for screen readers.
 */
export function LineChart({
  data,
  label,
  unit,
}: {
  data: { day: string; value: number }[];
  label: string;
  unit: string;
}) {
  const w = 720;
  const h = 220;
  const pad = 28;
  const max = Math.max(1, ...data.map((d) => d.value));
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, data.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const path = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`)
    .join(" ");
  const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0] ?? { day: "", value: 0 });
  return (
    <figure>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${label}: ${data.length} days, peak ${fmt(peak.value, unit)} on ${peak.day}`}
      >
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="currentColor" opacity="0.2" />
        <path d={path} fill="none" stroke="var(--color-brand)" strokeWidth="2.5" />
        <text x={pad} y={h - 8} fontSize="11" fill="currentColor" opacity="0.6">
          {data[0]?.day}
        </text>
        <text
          x={w - pad}
          y={h - 8}
          fontSize="11"
          textAnchor="end"
          fill="currentColor"
          opacity="0.6"
        >
          {data[data.length - 1]?.day}
        </text>
        <text x={pad} y={pad - 8} fontSize="11" fill="currentColor" opacity="0.6">
          {fmt(max, unit)}
        </text>
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{fmt(d.value, unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function BarList({
  data,
  unit,
}: {
  data: { category: string; value: number }[];
  unit: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="flex flex-col gap-2" aria-label="Breakdown by category">
      {data.map((d) => (
        <li key={d.category} className="text-sm">
          <div className="flex justify-between">
            <span>{d.category}</span>
            <span className="font-medium">{fmt(d.value, unit)}</span>
          </div>
          <div className="mt-1 h-2 rounded bg-subtle" aria-hidden="true">
            <div
              className="h-2 rounded bg-brand"
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
