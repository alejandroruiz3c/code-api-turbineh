import { and, asc, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { workflowEvents, workflowItems } from "@/db/schema";
import { audit } from "@/lib/audit";
import { UserFacingError } from "@/security/errors";
import { canSeeScope, visibleScopes, type ScopeContext } from "@/server/record-access";
import { workflowOf, type Workflow } from "./config";
import { canCreate, isOverdue, stateLabel, stuckHours, transitionError } from "./engine";

/**
 * Workflow service (component domain.workflow.turbineh): the only code that creates workflow records or changes their
 * state. Every change is checked against the definition (engine.ts), made under a row lock so two people cannot move
 * the same record at once, written to the immutable history with who and when, and recorded with audit().
 */
export interface Actor extends ScopeContext {
  email: string;
}

export type Item = typeof workflowItems.$inferSelect;

export function requireWorkflow(key: string): Workflow {
  const wf = workflowOf(key);
  if (!wf) throw new UserFacingError("Unknown workflow.");
  return wf;
}

/** Workspace and scope filter for the records this person may see. */
async function visible(ctx: Actor): Promise<SQL | undefined> {
  const scopes = await visibleScopes(ctx);
  if (scopes === "all") return eq(workflowItems.organizationId, ctx.organizationId);
  return and(
    eq(workflowItems.organizationId, ctx.organizationId),
    scopes.length ? inArray(workflowItems.scopeId, scopes) : isNull(workflowItems.id),
  );
}

export async function createItem(
  ctx: Actor,
  input: {
    workflow: string;
    title: string;
    description?: string | null;
    subjectId?: string | null;
    scopeId?: string | null;
    dueAt?: Date | null;
  },
): Promise<string> {
  const wf = requireWorkflow(input.workflow);
  if (!canCreate(wf, ctx.role))
    throw new UserFacingError(`Your role cannot create ${wf.plural.toLowerCase()}.`);
  const scopeId = input.scopeId ?? null;
  if (!(await canSeeScope(ctx, scopeId))) throw new UserFacingError("Choose one of your scopes.");
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(workflowItems)
      .values({
        organizationId: ctx.organizationId,
        workflow: wf.key,
        title: input.title.trim().slice(0, 200),
        description: input.description?.trim().slice(0, 5000) || null,
        subjectId: input.subjectId ?? null,
        scopeId,
        state: wf.initial,
        dueAt: wf.dueDate ? (input.dueAt ?? null) : null,
        createdBy: ctx.userId,
        createdByEmail: ctx.email.toLowerCase(),
      })
      .returning({ id: workflowItems.id });
    if (!row) throw new Error("workflow item not created");
    await tx.insert(workflowEvents).values({
      organizationId: ctx.organizationId,
      itemId: row.id,
      fromState: null,
      toState: wf.initial,
      actorId: ctx.userId,
      actorEmail: ctx.email.toLowerCase(),
    });
    return row.id;
  });
  await audit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: `${wf.key}.created`,
    subjectType: wf.label,
    subjectId: id,
    summary: `Created ${wf.label.toLowerCase()} "${input.title.trim().slice(0, 120)}" (${stateLabel(wf, wf.initial)})`,
  });
  return id;
}

/** A record this person may see, or a UserFacingError. */
export async function getItem(ctx: Actor, id: string): Promise<Item> {
  const [row] = await db
    .select()
    .from(workflowItems)
    .where(and(eq(workflowItems.id, id), await visible(ctx)))
    .limit(1);
  if (!row) throw new UserFacingError("Not found.");
  return row;
}

/** Moves a record to `to` when the definition and the person's role allow it; returns the new state. */
export async function transition(
  ctx: Actor,
  id: string,
  to: string,
  note?: string | null,
): Promise<string> {
  const item = await getItem(ctx, id);
  const wf = requireWorkflow(item.workflow);
  const from = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(workflowItems)
      .where(eq(workflowItems.id, item.id))
      .limit(1)
      .for("update");
    if (!locked) throw new UserFacingError("Not found.");
    const error = transitionError(wf, locked.state, to, {
      role: ctx.role,
      isCreator: locked.createdBy === ctx.userId,
    });
    if (error) throw new UserFacingError(error);
    await tx
      .update(workflowItems)
      .set({ state: to, stateSince: new Date() })
      .where(eq(workflowItems.id, item.id));
    await tx.insert(workflowEvents).values({
      organizationId: ctx.organizationId,
      itemId: item.id,
      fromState: locked.state,
      toState: to,
      actorId: ctx.userId,
      actorEmail: ctx.email.toLowerCase(),
      note: note?.trim().slice(0, 500) || null,
    });
    return locked.state;
  });
  await audit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: `${wf.key}.state_changed`,
    subjectType: wf.label,
    subjectId: item.id,
    summary: `"${item.title}": ${stateLabel(wf, from)} → ${stateLabel(wf, to)}`,
    before: { state: from },
    after: { state: to },
  });
  return to;
}

/** History of a record, oldest first (immutable). */
export async function history(ctx: Actor, id: string) {
  const item = await getItem(ctx, id);
  return db
    .select()
    .from(workflowEvents)
    .where(
      and(
        eq(workflowEvents.itemId, item.id),
        eq(workflowEvents.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(asc(workflowEvents.createdAt));
}

export interface ListedItem extends Item {
  stuckHours: number | null;
  overdue: boolean;
}

/** Records of a workflow this person may see, newest first, with stuck/overdue flags. */
export async function listItems(
  ctx: Actor,
  workflow: string,
  opts: { state?: string; now?: Date; limit?: number } = {},
): Promise<ListedItem[]> {
  const wf = requireWorkflow(workflow);
  const now = opts.now ?? new Date();
  const rows = await db
    .select()
    .from(workflowItems)
    .where(
      and(
        await visible(ctx),
        eq(workflowItems.workflow, wf.key),
        opts.state ? eq(workflowItems.state, opts.state) : undefined,
      ),
    )
    .orderBy(desc(workflowItems.createdAt))
    .limit(opts.limit ?? 500);
  return rows.map((r) => ({
    ...r,
    stuckHours: stuckHours(wf, r.state, r.stateSince, now),
    overdue: isOverdue(wf, r.state, r.dueAt, now),
  }));
}

/**
 * Every record of a workspace that is stuck (longer than its state's limit) or overdue — for alerts and scheduled
 * digests. Not filtered by scope: callers decide who is told.
 */
export async function attentionItems(organizationId: string | null, now = new Date()) {
  const rows = await db
    .select()
    .from(workflowItems)
    .where(organizationId ? eq(workflowItems.organizationId, organizationId) : undefined)
    .orderBy(asc(workflowItems.stateSince))
    .limit(5000);
  return rows
    .map((r) => {
      const wf = workflowOf(r.workflow);
      if (!wf) return null;
      return {
        ...r,
        workflowLabel: wf.label,
        stateLabel: stateLabel(wf, r.state),
        stuckHours: stuckHours(wf, r.state, r.stateSince, now),
        overdue: isOverdue(wf, r.state, r.dueAt, now),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null && (r.stuckHours !== null || r.overdue));
}
