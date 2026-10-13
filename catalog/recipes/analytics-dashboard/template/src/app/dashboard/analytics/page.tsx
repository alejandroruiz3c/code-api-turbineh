import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db/client";
import { dataPoints, datasets } from "@/db/schema";
import { requireMember } from "@/server/authz";
import { createDataset } from "./actions";

export default async function Analytics() {
  const ctx = await requireMember();
  const rows = await db
    .select({
      id: datasets.id,
      name: datasets.name,
      unit: datasets.unit,
      points: count(dataPoints.id),
    })
    .from(datasets)
    .leftJoin(dataPoints, eq(dataPoints.datasetId, datasets.id))
    .where(eq(datasets.organizationId, ctx.organizationId))
    .groupBy(datasets.id)
    .orderBy(desc(datasets.createdAt));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Analytics</h1>
      <Card title="New dataset">
        <form action={createDataset} className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <Label htmlFor="ds-name">Name</Label>
            <Input id="ds-name" name="name" required maxLength={120} placeholder="Monthly sales" />
          </div>
          <div>
            <Label htmlFor="ds-unit">Unit</Label>
            <Input id="ds-unit" name="unit" maxLength={24} placeholder="EUR" />
          </div>
          <Button type="submit">Create dataset</Button>
        </form>
      </Card>
      <ul className="grid gap-4 md:grid-cols-3">
        {rows.map((d) => (
          <li key={d.id} className="rounded-lg border border-line bg-panel p-5">
            <Link
              href={`/dashboard/analytics/${d.id}`}
              className="text-lg font-semibold hover:underline"
            >
              {d.name}
            </Link>
            <p className="mt-1 text-sm text-muted">
              {d.points} data points{d.unit ? ` · ${d.unit}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
