import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { AgentFields } from "@/components/agent-fields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/db/client";
import { agents } from "@/db/schema";
import { can, requireMember } from "@/server/authz";
import { createAgent } from "./actions";

export default async function Agents() {
  const ctx = await requireMember();
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.organizationId, ctx.organizationId))
    .orderBy(desc(agents.createdAt));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Assistants</h1>
      {can(ctx.role, "update") ? (
        <Card title="New assistant">
          <form action={createAgent} className="flex flex-col gap-3">
            <AgentFields prefix="new" />
            <div>
              <Button type="submit">Create assistant</Button>
            </div>
          </form>
        </Card>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">No assistants yet.</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-3">
          {rows.map((a) => (
            <li key={a.id} className="rounded-lg border border-slate-200 bg-white p-5">
              <Link
                href={`/dashboard/agents/${a.id}`}
                className="text-lg font-semibold hover:underline"
              >
                {a.name}
              </Link>
              <p className="mt-1 line-clamp-3 text-sm text-slate-600">{a.instructions}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
