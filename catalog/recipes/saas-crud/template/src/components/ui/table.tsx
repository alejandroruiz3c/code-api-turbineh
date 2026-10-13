import type { ReactNode } from "react";

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-line">
          {head.map((h) => (
            <th key={h} className="px-3 py-2 font-medium text-muted">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
