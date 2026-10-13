import { and, asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AgentFields } from "@/components/agent-fields";
import { ChatForm } from "@/components/chat-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/db/client";
import { agents, conversations, messages, pendingActions } from "@/db/schema";
import { can, requireMember } from "@/server/authz";
import { TOOL_LABELS } from "@/server/tools";
import { deleteAgent, resolveAction, updateAgent } from "../actions";

/** Chat with one assistant: messages, tool calls awaiting confirmation, settings. */
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMember();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id.data), eq(agents.organizationId, ctx.organizationId)));
  if (!agent) notFound();
  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, ctx.organizationId),
        eq(conversations.agentId, agent.id),
        eq(conversations.userId, ctx.userId),
      ),
    )
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  const turns = conv
    ? await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(asc(messages.createdAt))
    : [];
  const pending = conv
    ? await db
        .select()
        .from(pendingActions)
        .where(
          and(eq(pendingActions.conversationId, conv.id), eq(pendingActions.status, "pending")),
        )
    : [];
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{agent.name}</h1>
      {conv?.needsHuman ? (
        <p className="rounded bg-warning-soft p-2 text-sm text-warning">
          A person will follow up on this conversation.
        </p>
      ) : null}
      <section aria-label="Conversation" className="flex flex-col gap-3">
        {turns.length === 0 ? <p className="text-sm text-muted">Ask your first question.</p> : null}
        {turns.map((m) => (
          <article
            key={m.id}
            data-role={m.role}
            className={
              m.role === "user"
                ? "self-end rounded-lg bg-ink p-3 text-sm text-surface"
                : "rounded-lg border border-line bg-panel p-3 text-sm"
            }
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.sources.length > 0 ? (
              <p className="mt-2 text-xs text-muted">Sources: {m.sources.join(", ")}</p>
            ) : null}
          </article>
        ))}
        {pending.map((p) => (
          <form
            key={p.id}
            action={resolveAction}
            className="flex items-center gap-2 rounded bg-subtle p-3 text-sm"
          >
            <input type="hidden" name="id" value={p.id} />
            <span className="flex-1">Confirm: {TOOL_LABELS[p.tool] ?? p.tool}?</span>
            <Button type="submit" name="decision" value="confirm">
              Confirm
            </Button>
            <Button type="submit" name="decision" value="reject" className="bg-muted">
              Cancel
            </Button>
          </form>
        ))}
      </section>
      <ChatForm agentId={agent.id} />
      {can(ctx.role, "update") ? (
        <Card title="Settings">
          <form action={updateAgent} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={agent.id} />
            <AgentFields prefix="edit" values={agent} />
            <div>
              <Button type="submit">Save assistant</Button>
            </div>
          </form>
          <form action={deleteAgent} className="mt-4">
            <input type="hidden" name="id" value={agent.id} />
            <Button type="submit" className="bg-danger text-danger-contrast">
              Delete assistant
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
