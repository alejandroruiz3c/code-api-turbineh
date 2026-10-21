import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { AgentFields } from "@/components/agent-fields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/db/client";
import { agents, conversations } from "@/db/schema";
import { can, requireMember } from "@/server/authz";
import { createAgent } from "./actions";

/**
 * AI assistants of the workspace: list and create (instructions, allowed tools), and — for the team — the
 * conversations an assistant handed to a person (escalate_to_human), newest first.
 */
export default async function Agents() {
  const ctx = await requireMember();
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.organizationId, ctx.organizationId))
    .orderBy(desc(agents.createdAt));
  const escalated = can(ctx.role, "update")
    ? await db
        .select({
          id: conversations.id,
          title: conversations.title,
          agentId: conversations.agentId,
          agent: agents.name,
          createdAt: conversations.createdAt,
        })
        .from(conversations)
        .innerJoin(agents, eq(agents.id, conversations.agentId))
        .where(
          and(
            eq(conversations.organizationId, ctx.organizationId),
            eq(conversations.needsHuman, true),
          ),
        )
        .orderBy(desc(conversations.createdAt))
        .limit(50)
    : [];
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Assistants</h1>
      {can(ctx.role, "update") ? (
        <Card title={`Needs a person (${escalated.length})`}>
          {escalated.length === 0 ? (
            <p className="text-sm text-muted">No conversation is waiting for a person.</p>
          ) : (
            <ul aria-label="Needs a person" className="flex flex-col gap-2">
              {escalated.map((c) => (
                <li key={c.id} data-escalation={c.title} className="text-sm">
                  <Link href={`/dashboard/agents/${c.agentId}`} className="font-medium underline">
                    {c.title}
                  </Link>{" "}
                  <span className="text-muted">
                    · {c.agent} · {c.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
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
        <p className="text-sm text-muted">No assistants yet.</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-3">
          {rows.map((a) => (
            <li key={a.id} className="rounded-lg border border-line bg-panel p-5">
              <Link
                href={`/dashboard/agents/${a.id}`}
                className="text-lg font-semibold hover:underline"
              >
                {a.name}
              </Link>
              <p className="mt-1 line-clamp-3 text-sm text-muted">{a.instructions}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
