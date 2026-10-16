"use server";
import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { agents, conversations, messages, pendingActions } from "@/db/schema";
import { allowedTools } from "@/lib/ai/guard";
import { orchestrate } from "@/lib/ai/orchestrator";
import { auth } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { toUserMessage, UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { can, requireMember } from "@/server/authz";
// turbineh:module knowledge-base
import { searchKnowledge } from "@/server/knowledge";
// turbineh:end-module knowledge-base
import { isTool, TOOL_REGISTRY } from "@/server/tools";

const agentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  instructions: z.string().trim().min(10).max(4000),
});

const toolsFrom = (formData: FormData) =>
  [...new Set(formData.getAll("tools").map(String))].filter(isTool);

async function requireAdmin() {
  const ctx = await requireMember();
  if (!can(ctx.role, "update"))
    throw new UserFacingError("Only owners and admins can manage assistants.");
  return ctx;
}

export async function createAgent(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const input = agentSchema.parse(Object.fromEntries(formData));
  const [row] = await db
    .insert(agents)
    .values({
      organizationId: ctx.organizationId,
      name: input.name,
      instructions: input.instructions,
      tools: toolsFrom(formData),
      useKnowledge: formData.get("useKnowledge") === "on",
      createdBy: ctx.userId,
    })
    .returning({ id: agents.id });
  revalidatePath("/dashboard/agents");
  if (row) redirect(`/dashboard/agents/${row.id}`);
}

export async function updateAgent(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const id = z.uuid().parse(formData.get("id"));
  const input = agentSchema.parse(Object.fromEntries(formData));
  await db
    .update(agents)
    .set({
      name: input.name,
      instructions: input.instructions,
      tools: toolsFrom(formData),
      useKnowledge: formData.get("useKnowledge") === "on",
    })
    .where(and(eq(agents.id, id), eq(agents.organizationId, ctx.organizationId)));
  revalidatePath(`/dashboard/agents/${id}`);
}

export async function deleteAgent(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const id = z.uuid().parse(formData.get("id"));
  await db
    .delete(agents)
    .where(and(eq(agents.id, id), eq(agents.organizationId, ctx.organizationId)));
  revalidatePath("/dashboard/agents");
  redirect("/dashboard/agents");
}

export type ChatState = { error: string | null };

/** One chat turn: knowledge search, orchestrated answer, tool handling. Errors come back as safe messages. */
export async function sendMessage(_prev: ChatState, formData: FormData): Promise<ChatState> {
  const ctx = await requireMember();
  try {
    if (!(await rateLimit(`chat:${ctx.userId}`, 30)))
      return { error: "Too many messages. Try again later." };
    const agentId = z.uuid().parse(formData.get("agentId"));
    const text = z.string().trim().min(1).max(8000).parse(formData.get("text"));
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organizationId, ctx.organizationId)));
    if (!agent) return { error: "Assistant not found." };
    const [existing] = await db
      .select({ id: conversations.id })
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
    const history = existing
      ? await db
          .select({ role: messages.role, content: messages.content })
          .from(messages)
          .where(eq(messages.conversationId, existing.id))
          .orderBy(desc(messages.createdAt))
          .limit(10)
      : [];
    // turbineh:module knowledge-base
    const docs = agent.useKnowledge ? await searchKnowledge(ctx, text) : [];
    // turbineh:end-module knowledge-base
    // turbineh:without-module knowledge-base
    const docs: { title: string; content: string }[] = [];
    // turbineh:end-without-module knowledge-base
    const result = await orchestrate({
      task: "Reply to the user's message as this assistant. Use the reference documents when they are relevant.",
      input: text,
      purpose: "agent-chat",
      instructions: agent.instructions,
      context: docs.map((d) => ({ title: d.title, text: d.content })),
      history: history
        .reverse()
        .filter(
          (m): m is { role: "user" | "assistant"; content: string } =>
            m.role === "user" || m.role === "assistant",
        ),
      tools: allowedTools(TOOL_REGISTRY, agent.tools),
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    });
    const conversationId =
      existing?.id ??
      (
        await db
          .insert(conversations)
          .values({
            organizationId: ctx.organizationId,
            agentId: agent.id,
            userId: ctx.userId,
            title: text.slice(0, 120),
          })
          .returning({ id: conversations.id })
      )[0]?.id;
    if (!conversationId) throw new Error("conversation not created");
    await db.insert(messages).values({
      organizationId: ctx.organizationId,
      conversationId,
      role: "user",
      content: text,
    });
    await db.insert(messages).values({
      organizationId: ctx.organizationId,
      conversationId,
      role: "assistant",
      content: result.text,
      route: result.route,
      sources: [...new Set(docs.map((d) => d.title))],
    });
    if (result.tool?.confirm) {
      await db.insert(pendingActions).values({
        organizationId: ctx.organizationId,
        conversationId,
        tool: result.tool.spec.name,
        payload: result.text,
        createdBy: ctx.userId,
      });
    } else if (result.tool?.spec.name === "escalate_to_human") {
      await db
        .update(conversations)
        .set({ needsHuman: true })
        .where(eq(conversations.id, conversationId));
      await db.insert(messages).values({
        organizationId: ctx.organizationId,
        conversationId,
        role: "tool",
        content: "A person from the team will follow up on this conversation.",
      });
    }
    revalidatePath(`/dashboard/agents/${agent.id}`);
    return { error: null };
  } catch (err) {
    return { error: toUserMessage(err) };
  }
}

/** Irreversible tool actions run only after the user who asked confirms them. */
export async function resolveAction(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  const id = z.uuid().parse(formData.get("id"));
  const decision = z.enum(["confirm", "reject"]).parse(formData.get("decision"));
  const [action] = await db
    .select()
    .from(pendingActions)
    .where(
      and(
        eq(pendingActions.id, id),
        eq(pendingActions.organizationId, ctx.organizationId),
        eq(pendingActions.createdBy, ctx.userId),
        eq(pendingActions.status, "pending"),
      ),
    );
  if (!action) throw new UserFacingError("This action is no longer pending.");
  let note = "Cancelled: nothing was sent.";
  if (decision === "confirm" && action.tool === "email_me") {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UserFacingError("Please sign in again.");
    await sendEmail({
      to: session.user.email,
      subject: "Your assistant's answer",
      text: action.payload,
    });
    note = "Email sent to your address.";
  }
  await db
    .update(pendingActions)
    .set({ status: decision === "confirm" ? "done" : "rejected" })
    .where(eq(pendingActions.id, action.id));
  await db.insert(messages).values({
    organizationId: ctx.organizationId,
    conversationId: action.conversationId,
    role: "tool",
    content: note,
  });
  const [conv] = await db
    .select({ agentId: conversations.agentId })
    .from(conversations)
    .where(eq(conversations.id, action.conversationId))
    .orderBy(asc(conversations.createdAt));
  if (conv) revalidatePath(`/dashboard/agents/${conv.agentId}`);
}
