import Link from "next/link";
import { Card } from "@/components/ui/card";
import { dataset as ds, label } from "@/analytics-import/config";
import { recentImports } from "@/analytics-import/service";
import { requireMember } from "@/server/authz";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

/** CSV import (data.analytics-import.turbineh): expected columns, the upload with its report, recent imports. */
export default async function ImportPage() {
  const ctx = await requireMember();
  const imports = await recentImports(ctx);
  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/reports" className="text-sm text-accent underline">
        ← Dashboard
      </Link>
      <Card title={`Import ${label(ds.entity).toLowerCase()} data`}>
        <p className="mb-4 text-sm text-muted">
          Columns: <code data-testid="columns">{ds.columns.join(",")}</code>. Dates as YYYY-MM-DD;{" "}
          {ds.measures.map(label).join(", ")} as numbers. A file with any invalid row imports
          nothing.
        </p>
        <ImportForm />
      </Card>
      <Card title="Recent imports">
        <ul className="flex flex-col gap-1 text-sm">
          {imports.map((i) => (
            <li key={i.id}>
              {i.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {i.fileName} · {i.rows}{" "}
              rows · {i.createdByEmail}
            </li>
          ))}
        </ul>
        {imports.length === 0 ? <p className="text-sm text-muted">No imports yet.</p> : null}
      </Card>
    </div>
  );
}
