import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db/client";
import { processes, processItems } from "@/db/schema";
import { can, requireMember } from "@/server/authz";
import { createProcess } from "./actions";

const KIND_LABELS = {
  classify: "Classify",
  extract: "Extract fields",
  summarize: "Summarise",
} as const;

export default async function Processes() {
  const ctx = await requireMember();
  const rows = await db
    .select({
      id: processes.id,
      name: processes.name,
      kind: processes.kind,
      done: sql<number>`count(${processItems.id}) filter (where ${processItems.status} = 'done')::int`,
      total: sql<number>`count(${processItems.id})::int`,
    })
    .from(processes)
    .leftJoin(processItems, eq(processItems.processId, processes.id))
    .where(eq(processes.organizationId, ctx.organizationId))
    .groupBy(processes.id)
    .orderBy(desc(processes.createdAt));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">AI processes</h1>
      <p className="text-sm text-slate-600">
        Run the same AI task over many records: classify, extract or summarise.
      </p>
      {can(ctx.role, "update") ? (
        <Card title="New process">
          <form action={createProcess} className="flex flex-col gap-3">
            <div>
              <Label htmlFor="pr-name">Name</Label>
              <Input id="pr-name" name="name" required maxLength={80} />
            </div>
            <div>
              <Label htmlFor="pr-kind">Kind</Label>
              <select
                id="pr-kind"
                name="kind"
                className="rounded-md border border-slate-300 p-2 text-sm"
              >
                {Object.entries(KIND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="pr-instruction">Instruction</Label>
              <Input id="pr-instruction" name="instruction" required maxLength={2000} />
            </div>
            <div>
              <Label htmlFor="pr-labels">Labels (classify only, comma-separated)</Label>
              <Input id="pr-labels" name="labels" maxLength={1000} />
            </div>
            <div>
              <Button type="submit">Create process</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-3">
        {rows.map((p) => (
          <li key={p.id} className="rounded-lg border border-slate-200 bg-white p-5">
            <Link
              href={`/dashboard/processes/${p.id}`}
              className="text-lg font-semibold hover:underline"
            >
              {p.name}
            </Link>
            <p className="mt-1 text-sm text-slate-600">
              {KIND_LABELS[p.kind as keyof typeof KIND_LABELS] ?? p.kind} · {p.done}/{p.total} done
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
