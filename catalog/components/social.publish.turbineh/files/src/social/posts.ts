import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db, type Executor } from "@/db/client";
import { socialConnections, socialPosts, socialPublicationLog } from "@/db/schema";
import { audit } from "@/lib/audit";
import { zonedToUtc } from "@/lib/datetime";
import { UserFacingError } from "@/security/errors";
import { can } from "@/server/authz";
import { accessTokenFor, markExpired, type Ctx } from "./connections";
import { TokenKeyError } from "./crypto";
import { ProviderError } from "./http";
import { compositionProblems } from "./limits";
import { isNetwork, type Network } from "./networks";
import { publishConfig } from "./publish-config";
import { publishTo, type PublishDeps } from "./publishers";
import { afterFailure } from "./retry";

/**
 * Social posts (component social.publish.turbineh): compose for one or more connected accounts, approve (when the app
 * requires it), schedule, publish with retries, and log every step. One row per post and account, unique per
 * idempotency key; the runner (`runDuePosts`, called by the protected cron route) publishes each post at most once.
 */
export type PostStatus =
  | "draft"
  | "pending_approval"
  | "scheduled"
  | "publishing"
  | "retrying"
  | "published"
  | "failed"
  | "unknown"
  | "cancelled";

/** A claimed attempt may take this long; after it, the attempt is treated as interrupted (outcome unknown). */
const LEASE_MS = 3 * 60_000;

async function log(
  ex: Executor,
  entry: {
    organizationId: string;
    postId: string;
    network: string;
    event: string;
    attempt?: number;
    httpStatus?: number | null;
    detail?: string | null;
    actorId?: string | null;
  },
) {
  await ex.insert(socialPublicationLog).values({
    ...entry,
    attempt: entry.attempt ?? 0,
    httpStatus: entry.httpStatus ?? null,
    detail: entry.detail?.slice(0, 300) ?? null,
    actorId: entry.actorId ?? null,
  });
}

export interface ComposeInput {
  connectionIds: string[];
  text: string;
  /** Network-specific versions of the text (e.g. a shorter one for X). */
  versions: Partial<Record<Network, string>>;
  imageUrl: string | null;
  /** Local date and time as typed (YYYY-MM-DDTHH:mm) and its IANA zone. */
  scheduledLocal: string;
  timeZone: string;
  /** One per form render: sending the same form twice creates nothing new. */
  idempotencyKey: string;
  /** draft: keep editing; submit: schedule (or ask for approval when the app requires it). */
  intent: "draft" | "submit";
}

export async function composePosts(
  ctx: Ctx,
  input: ComposeInput,
  now = new Date(),
): Promise<{ created: number; status: PostStatus }> {
  if (!can(ctx.role, "create"))
    throw new UserFacingError("You cannot create posts in this workspace.");
  if (input.connectionIds.length === 0)
    throw new UserFacingError("Choose at least one connected account.");
  const conns = await db
    .select({
      id: socialConnections.id,
      network: socialConnections.network,
      status: socialConnections.status,
      accountName: socialConnections.accountName,
    })
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.organizationId, ctx.organizationId),
        inArray(socialConnections.id, input.connectionIds),
      ),
    );
  if (
    conns.length !== new Set(input.connectionIds).size ||
    conns.some((c) => c.status !== "active")
  )
    throw new UserFacingError("One of the chosen accounts is not connected any more.");
  const networks = conns.map((c) => c.network).filter(isNetwork);
  const off = networks.filter((n) => !publishConfig.networks.includes(n));
  if (off.length) throw new UserFacingError(`This app does not publish to ${off.join(", ")}.`);
  const problems = compositionProblems(input, networks);
  if (problems.length) throw new UserFacingError(problems.map((p) => p.message).join(" "));
  const scheduledAt = zonedToUtc(input.scheduledLocal, input.timeZone);
  if (input.intent === "submit" && scheduledAt.getTime() < now.getTime() - 5 * 60_000)
    throw new UserFacingError("The publication time is in the past. Choose a time from now on.");
  const status: PostStatus =
    input.intent === "draft"
      ? "draft"
      : publishConfig.requireApproval
        ? "pending_approval"
        : "scheduled";
  let created = 0;
  await db.transaction(async (tx) => {
    for (const c of conns) {
      const network = c.network as Network;
      const [row] = await tx
        .insert(socialPosts)
        .values({
          organizationId: ctx.organizationId,
          connectionId: c.id,
          network,
          idempotencyKey: `${input.idempotencyKey}:${c.id}`.slice(0, 80),
          text: (input.versions[network] ?? input.text).trim(),
          imageUrl: input.imageUrl,
          scheduledAt,
          scheduledTimeZone: input.timeZone,
          status,
          maxAttempts: publishConfig.maxAttempts,
          nextAttemptAt: status === "scheduled" ? scheduledAt : null,
          createdBy: ctx.userId,
        })
        .onConflictDoNothing()
        .returning({ id: socialPosts.id });
      if (!row) continue;
      created += 1;
      await log(tx, {
        organizationId: ctx.organizationId,
        postId: row.id,
        network,
        event: "created",
        actorId: ctx.userId,
        detail: status,
      });
      await audit(
        {
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          actorEmail: ctx.email ?? null,
          action: "social.post_created",
          subjectType: "social_post",
          subjectId: row.id,
          summary: `Post for ${c.accountName} (${network}) ${status.replace("_", " ")}`,
        },
        tx,
      );
    }
  });
  return { created, status };
}

async function transition(
  ctx: Ctx,
  id: string,
  from: PostStatus[],
  to: PostStatus,
  event: string,
  extra: Partial<typeof socialPosts.$inferInsert> = {},
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(socialPosts)
      .set({ status: to, updatedAt: new Date(), ...extra })
      .where(
        and(
          eq(socialPosts.organizationId, ctx.organizationId),
          eq(socialPosts.id, id),
          inArray(socialPosts.status, from),
        ),
      )
      .returning({ id: socialPosts.id, network: socialPosts.network });
    if (!row) throw new UserFacingError("This post cannot change from its current status.");
    await log(tx, {
      organizationId: ctx.organizationId,
      postId: id,
      network: row.network,
      event,
      actorId: ctx.userId,
    });
    await audit(
      {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        actorEmail: ctx.email ?? null,
        action: `social.post_${event}`,
        subjectType: "social_post",
        subjectId: id,
        summary: `Post ${event} (${row.network})`,
      },
      tx,
    );
  });
}

/** Sends a draft on: to approval when the app requires it, otherwise straight to the schedule. */
export async function submitPost(ctx: Ctx, id: string): Promise<void> {
  if (!can(ctx.role, "create")) throw new UserFacingError("You cannot submit posts.");
  const [p] = await db
    .select()
    .from(socialPosts)
    .where(and(eq(socialPosts.organizationId, ctx.organizationId), eq(socialPosts.id, id)));
  if (!p) throw new UserFacingError("Post not found.");
  if (p.createdBy !== ctx.userId && !can(ctx.role, "update"))
    throw new UserFacingError("Only its author can submit this draft.");
  if (publishConfig.requireApproval)
    await transition(ctx, id, ["draft"], "pending_approval", "submitted");
  else
    await transition(ctx, id, ["draft"], "scheduled", "scheduled", {
      nextAttemptAt: p.scheduledAt,
    });
}

/** Approves a post waiting for approval: it is scheduled for its time (or the next run when that time has passed). */
export async function approvePost(ctx: Ctx, id: string): Promise<void> {
  if (!can(ctx.role, "approve"))
    throw new UserFacingError("Only people who may approve can approve posts.");
  const [p] = await db
    .select()
    .from(socialPosts)
    .where(and(eq(socialPosts.organizationId, ctx.organizationId), eq(socialPosts.id, id)));
  if (!p) throw new UserFacingError("Post not found.");
  await transition(ctx, id, ["pending_approval"], "scheduled", "approved", {
    approvedBy: ctx.userId,
    approvedAt: new Date(),
    nextAttemptAt: p.scheduledAt,
  });
}

/** Sends a post waiting for approval back to its author as a draft. */
export async function rejectPost(ctx: Ctx, id: string): Promise<void> {
  if (!can(ctx.role, "approve"))
    throw new UserFacingError("Only people who may approve can reject posts.");
  await transition(ctx, id, ["pending_approval"], "draft", "rejected");
}

export async function cancelPost(ctx: Ctx, id: string): Promise<void> {
  const [p] = await db
    .select()
    .from(socialPosts)
    .where(and(eq(socialPosts.organizationId, ctx.organizationId), eq(socialPosts.id, id)));
  if (!p) throw new UserFacingError("Post not found.");
  if (p.createdBy !== ctx.userId && !can(ctx.role, "update"))
    throw new UserFacingError("You cannot cancel this post.");
  await transition(
    ctx,
    id,
    ["draft", "pending_approval", "scheduled", "retrying", "failed", "unknown"],
    "cancelled",
    "cancelled",
    {
      nextAttemptAt: null,
    },
  );
}

/** A person decides to try a failed (or unknown-outcome) post again: a fresh set of attempts from now. */
export async function retryPost(ctx: Ctx, id: string): Promise<void> {
  if (!can(ctx.role, "update")) throw new UserFacingError("You cannot retry posts.");
  await transition(ctx, id, ["failed", "unknown"], "scheduled", "scheduled", {
    attempts: 0,
    nextAttemptAt: new Date(),
    lastError: null,
  });
}

export const POST_COLUMNS = {
  id: socialPosts.id,
  connectionId: socialPosts.connectionId,
  network: socialPosts.network,
  text: socialPosts.text,
  imageUrl: socialPosts.imageUrl,
  scheduledAt: socialPosts.scheduledAt,
  scheduledTimeZone: socialPosts.scheduledTimeZone,
  status: socialPosts.status,
  attempts: socialPosts.attempts,
  maxAttempts: socialPosts.maxAttempts,
  nextAttemptAt: socialPosts.nextAttemptAt,
  externalId: socialPosts.externalId,
  externalUrl: socialPosts.externalUrl,
  lastError: socialPosts.lastError,
  createdBy: socialPosts.createdBy,
  publishedAt: socialPosts.publishedAt,
  accountName: socialConnections.accountName,
} as const;

/** Posts of a period (calendar and list), oldest first. */
export async function listPosts(organizationId: string, from: Date, to: Date) {
  return db
    .select(POST_COLUMNS)
    .from(socialPosts)
    .innerJoin(socialConnections, eq(socialConnections.id, socialPosts.connectionId))
    .where(
      and(
        eq(socialPosts.organizationId, organizationId),
        gte(socialPosts.scheduledAt, from),
        lt(socialPosts.scheduledAt, to),
      ),
    )
    .orderBy(asc(socialPosts.scheduledAt));
}

export async function getPost(organizationId: string, id: string) {
  const [post] = await db
    .select(POST_COLUMNS)
    .from(socialPosts)
    .innerJoin(socialConnections, eq(socialConnections.id, socialPosts.connectionId))
    .where(and(eq(socialPosts.organizationId, organizationId), eq(socialPosts.id, id)));
  if (!post) return null;
  const entries = await db
    .select()
    .from(socialPublicationLog)
    .where(
      and(
        eq(socialPublicationLog.organizationId, organizationId),
        eq(socialPublicationLog.postId, id),
      ),
    )
    .orderBy(desc(socialPublicationLog.at));
  return { post, log: entries };
}

export interface RunReport {
  published: { id: string; network: string; externalId: string }[];
  retrying: { id: string; network: string; at: string; error: string }[];
  failed: { id: string; network: string; error: string }[];
  unknown: { id: string; network: string }[];
}

/** X answers a repeated text with 403 "duplicate content": after an earlier attempt, that one most likely went out. */
const duplicateAfterRetry = (err: ProviderError, attempt: number) =>
  attempt > 1 && err.network === "x" && err.status === 403 && /duplicate/i.test(err.message);

/**
 * Publishes the posts that are due (status scheduled or retrying, next attempt time reached). Each post is claimed by
 * a conditional update (status → publishing, with a lease), so concurrent runners never publish it twice. A claim
 * whose lease ran out was interrupted after it may have been sent: it becomes `unknown` and is not retried
 * automatically (a person checks the network, then retries or cancels).
 */
export async function runDuePosts(
  opts: { now?: Date; limit?: number; deps?: PublishDeps } = {},
): Promise<RunReport> {
  const now = opts.now ?? new Date();
  const report: RunReport = { published: [], retrying: [], failed: [], unknown: [] };
  const stale = await db
    .update(socialPosts)
    .set({
      status: "unknown",
      leaseUntil: null,
      updatedAt: now,
      lastError: "The attempt was interrupted; check the network before retrying",
    })
    .where(and(eq(socialPosts.status, "publishing"), lt(socialPosts.leaseUntil, now)))
    .returning({
      id: socialPosts.id,
      organizationId: socialPosts.organizationId,
      network: socialPosts.network,
      attempts: socialPosts.attempts,
    });
  for (const s of stale) {
    await log(db, {
      organizationId: s.organizationId,
      postId: s.id,
      network: s.network,
      event: "unknown",
      attempt: s.attempts,
      detail: "interrupted attempt",
    });
    report.unknown.push({ id: s.id, network: s.network });
  }
  const due = await db
    .select({ id: socialPosts.id, status: socialPosts.status })
    .from(socialPosts)
    .where(
      and(
        inArray(socialPosts.status, ["scheduled", "retrying"]),
        lte(socialPosts.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(socialPosts.nextAttemptAt))
    .limit(opts.limit ?? 20);
  for (const d of due) {
    const [p] = await db
      .update(socialPosts)
      .set({
        status: "publishing",
        attempts: sql`${socialPosts.attempts} + 1`,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(socialPosts.id, d.id),
          eq(socialPosts.status, d.status),
          lte(socialPosts.nextAttemptAt, now),
        ),
      )
      .returning();
    if (!p) continue; // another runner claimed it
    const network = p.network as Network;
    await log(db, {
      organizationId: p.organizationId,
      postId: p.id,
      network,
      event: "attempt",
      attempt: p.attempts,
    });
    try {
      const { token, accountId } = await accessTokenFor(p.organizationId, p.connectionId, now);
      const out = await publishTo(
        { network, token, accountId, text: p.text, imageUrl: p.imageUrl },
        opts.deps,
      );
      await db.transaction(async (tx) => {
        await tx
          .update(socialPosts)
          .set({
            status: "published",
            externalId: out.externalId,
            externalUrl: out.externalUrl,
            publishedAt: new Date(),
            leaseUntil: null,
            nextAttemptAt: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(socialPosts.id, p.id));
        await log(tx, {
          organizationId: p.organizationId,
          postId: p.id,
          network,
          event: "published",
          attempt: p.attempts,
          detail: out.externalId,
        });
      });
      report.published.push({ id: p.id, network, externalId: out.externalId });
    } catch (err) {
      const e =
        err instanceof ProviderError
          ? err
          : err instanceof UserFacingError || err instanceof TokenKeyError
            ? // Not connected any more, or the token key is missing: retrying cannot help.
              new ProviderError(network, 409, "not_connected", err.message)
            : new ProviderError(network, 0, null, err instanceof Error ? err.name : "error");
      if (e.unauthorized && e.code !== "expired")
        await markExpired(p.organizationId, p.connectionId, `Token refused (${e.summary})`);
      const outcome = duplicateAfterRetry(e, p.attempts)
        ? ({ kind: "unknown" } as const)
        : afterFailure({
            attempt: p.attempts,
            maxAttempts: p.maxAttempts,
            retryable: e.retryable && !e.unauthorized,
            retryAfterMs: e.retryAfterMs,
            now,
          });
      const status: PostStatus =
        outcome.kind === "retry" ? "retrying" : outcome.kind === "unknown" ? "unknown" : "failed";
      await db.transaction(async (tx) => {
        await tx
          .update(socialPosts)
          .set({
            status,
            leaseUntil: null,
            nextAttemptAt: outcome.kind === "retry" ? outcome.at : null,
            lastError: e.summary.slice(0, 300),
            updatedAt: new Date(),
          })
          .where(eq(socialPosts.id, p.id));
        await log(tx, {
          organizationId: p.organizationId,
          postId: p.id,
          network,
          event: outcome.kind === "retry" ? "retry" : status,
          attempt: p.attempts,
          httpStatus: e.status || null,
          detail: e.summary,
        });
      });
      if (outcome.kind === "retry")
        report.retrying.push({ id: p.id, network, at: outcome.at.toISOString(), error: e.summary });
      else if (outcome.kind === "unknown") report.unknown.push({ id: p.id, network });
      else report.failed.push({ id: p.id, network, error: e.summary });
    }
  }
  return report;
}
