import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accessScopeMembers, accessScopes, membershipInvitations } from "@/db/schema";
import { env } from "@/env";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { UserFacingError } from "@/security/errors";
import { membershipConfig as cfg } from "./config";
import {
  checkInvitation,
  grantableRoles,
  hashToken,
  needsScope,
  newInvitationToken,
  normEmail,
  roleChangeError,
} from "./rules";

/**
 * Membership service (component domain.membership-access.turbineh): the only code that invites, accepts, changes roles,
 * removes members and manages per-record scopes. Every function receives the caller (from requireMember() or
 * requireSession()) and enforces the rules in rules.ts; every change is recorded with audit().
 */
export interface Actor {
  userId: string;
  email: string;
  organizationId: string;
  role: string;
}

export async function workspaceName(organizationId: string): Promise<string> {
  const r = await db.execute<{ name: string }>(
    sql`select name from organization where id = ${organizationId} limit 1`,
  );
  return r.rows[0]?.name ?? "the workspace";
}

export async function listMembers(organizationId: string) {
  const r = await db.execute<{
    id: string;
    userId: string;
    role: string;
    email: string;
    name: string;
  }>(
    sql`select m.id, m."userId" as "userId", m.role, u.email, u.name
          from member m join "user" u on u.id = m."userId"
         where m."organizationId" = ${organizationId}
         order by m."createdAt" asc`,
  );
  return r.rows;
}

export async function listInvitations(organizationId: string) {
  return db
    .select()
    .from(membershipInvitations)
    .where(
      and(
        eq(membershipInvitations.organizationId, organizationId),
        eq(membershipInvitations.status, "pending"),
      ),
    )
    .orderBy(desc(membershipInvitations.createdAt));
}

/** Invites `email` with `role` (and a scope when the role needs one); emails the link and returns it. */
export async function invite(
  actor: Actor,
  input: { email: string; role: string; scopeId: string | null },
): Promise<{ link: string }> {
  const email = normEmail(input.email);
  if (!grantableRoles(cfg, actor.role).includes(input.role))
    throw new UserFacingError("You cannot invite with that role.");
  if (needsScope(cfg, input.role) && !input.scopeId)
    throw new UserFacingError(
      `Choose the ${cfg.scope?.label.toLowerCase() ?? "scope"} this person belongs to.`,
    );
  if (input.scopeId) await ownScope(actor.organizationId, input.scopeId);
  const existing = await db.execute<{ id: string }>(
    sql`select m.id from member m join "user" u on u.id = m."userId"
         where m."organizationId" = ${actor.organizationId} and lower(u.email) = ${email} limit 1`,
  );
  if (existing.rows.length) throw new UserFacingError(`${email} is already a member.`);
  const { token, tokenHash } = newInvitationToken();
  const [row] = await db.transaction(async (tx) => {
    // A new invitation replaces any pending one for the same address.
    await tx
      .update(membershipInvitations)
      .set({ status: "revoked" })
      .where(
        and(
          eq(membershipInvitations.organizationId, actor.organizationId),
          eq(membershipInvitations.email, email),
          eq(membershipInvitations.status, "pending"),
        ),
      );
    return tx
      .insert(membershipInvitations)
      .values({
        organizationId: actor.organizationId,
        email,
        role: input.role,
        scopeId: input.scopeId,
        tokenHash,
        invitedBy: actor.userId,
        expiresAt: new Date(Date.now() + cfg.invitationDays * 86_400_000),
      })
      .returning({ id: membershipInvitations.id });
  });
  const link = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/invite/${token}`;
  const workspace = await workspaceName(actor.organizationId);
  const roleLabel = cfg.roles.find((r) => r.key === input.role)?.label ?? input.role;
  await sendEmail({
    to: email,
    subject: `You are invited to ${workspace}`,
    text: `${actor.email} invited you to join "${workspace}" as ${roleLabel}.\n\nAccept the invitation:\n\n${link}\n\nThe link works once and expires in ${cfg.invitationDays} days. If you did not expect it, ignore this email.`,
    link,
  });
  await audit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "invitation.created",
    subjectType: "Invitation",
    subjectId: row?.id ?? null,
    summary: `Invited ${email} as ${roleLabel}`,
  });
  return { link };
}

export async function revokeInvitation(actor: Actor, id: string): Promise<void> {
  const [row] = await db
    .update(membershipInvitations)
    .set({ status: "revoked" })
    .where(
      and(
        eq(membershipInvitations.id, id),
        eq(membershipInvitations.organizationId, actor.organizationId),
        eq(membershipInvitations.status, "pending"),
      ),
    )
    .returning({ email: membershipInvitations.email });
  if (row)
    await audit({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "invitation.revoked",
      subjectType: "Invitation",
      subjectId: id,
      summary: `Revoked the invitation of ${row.email}`,
    });
}

/** The invitation behind a link, for the landing page (never reveals the token hash). */
export async function invitationByToken(token: string) {
  if (token.length < 20 || token.length > 100) return null;
  const [inv] = await db
    .select()
    .from(membershipInvitations)
    .where(eq(membershipInvitations.tokenHash, hashToken(token)))
    .limit(1);
  return inv ?? null;
}

/**
 * The signed-in person accepts: once, before expiry, only with the invited email. Joins the workspace with the
 * invited role (and scope). Returns the workspace id.
 */
export async function acceptInvitation(
  session: { userId: string; email: string },
  token: string,
  now = new Date(),
): Promise<string> {
  const result = await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(membershipInvitations)
      .where(eq(membershipInvitations.tokenHash, hashToken(token)))
      .limit(1)
      .for("update");
    const check = checkInvitation(inv ?? null, session.email, now);
    if (!check.ok || !inv) return { error: check.ok ? "invalid" : check.reason };
    const existing = await tx.execute<{ id: string }>(
      sql`select id from member where "organizationId" = ${inv.organizationId} and "userId" = ${session.userId}`,
    );
    if (!existing.rows.length) {
      await tx.execute(
        sql`insert into member (id, "organizationId", "userId", role, "createdAt")
            values (${randomUUID()}, ${inv.organizationId}, ${session.userId}, ${inv.role}, now())`,
      );
    }
    if (inv.scopeId) {
      await tx
        .insert(accessScopeMembers)
        .values({
          scopeId: inv.scopeId,
          userId: session.userId,
          organizationId: inv.organizationId,
        })
        .onConflictDoNothing();
    }
    await tx
      .update(membershipInvitations)
      .set({ status: "accepted", acceptedBy: session.userId, acceptedAt: now })
      .where(eq(membershipInvitations.id, inv.id));
    return { inv };
  });
  if ("error" in result) {
    const message = {
      invalid: "This invitation is not valid.",
      used: "This invitation was already used.",
      expired: "This invitation has expired. Ask for a new one.",
      "wrong-email": "Sign in with the email address the invitation was sent to.",
    }[result.error ?? "invalid"];
    throw new UserFacingError(message ?? "This invitation is not valid.");
  }
  const { inv } = result;
  await audit({
    organizationId: inv.organizationId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "invitation.accepted",
    subjectType: "Member",
    subjectId: session.userId,
    summary: `${normEmail(session.email)} joined as ${inv.role}`,
  });
  return inv.organizationId;
}

async function memberOf(organizationId: string, memberId: string) {
  const r = await db.execute<{ userId: string; role: string; email: string; owners: number }>(
    sql`select m."userId" as "userId", m.role, u.email,
               (select count(*)::int from member o where o."organizationId" = ${organizationId} and o.role = 'owner') as owners
          from member m join "user" u on u.id = m."userId"
         where m.id = ${memberId} and m."organizationId" = ${organizationId}`,
  );
  const row = r.rows[0];
  if (!row) throw new UserFacingError("That member no longer exists.");
  return row;
}

/** Changes a member's role (null removes the member), under roleChangeError's rules. */
export async function changeRole(actor: Actor, memberId: string, newRole: string | null) {
  const target = await memberOf(actor.organizationId, memberId);
  const error = roleChangeError({
    cfg,
    actorRole: actor.role,
    actorUserId: actor.userId,
    targetUserId: target.userId,
    targetRole: target.role,
    newRole,
    owners: Number(target.owners),
  });
  if (error) throw new UserFacingError(error);
  if (newRole === null) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`delete from member where id = ${memberId} and "organizationId" = ${actor.organizationId}`,
      );
      await tx
        .delete(accessScopeMembers)
        .where(
          and(
            eq(accessScopeMembers.organizationId, actor.organizationId),
            eq(accessScopeMembers.userId, target.userId),
          ),
        );
    });
  } else if (newRole !== target.role) {
    await db.execute(
      sql`update member set role = ${newRole} where id = ${memberId} and "organizationId" = ${actor.organizationId}`,
    );
  }
  await audit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorEmail: actor.email,
    action: newRole === null ? "member.removed" : "member.role_changed",
    subjectType: "Member",
    subjectId: target.userId,
    summary:
      newRole === null
        ? `Removed ${target.email} (${target.role})`
        : `${target.email}: ${target.role} → ${newRole}`,
    before: { role: target.role },
    after: newRole === null ? null : { role: newRole },
  });
}

// ─── Per-record scopes ─────────────────────────────────────────────────────────────────────────────────────────

async function ownScope(organizationId: string, scopeId: string) {
  const [s] = await db
    .select()
    .from(accessScopes)
    .where(and(eq(accessScopes.id, scopeId), eq(accessScopes.organizationId, organizationId)))
    .limit(1);
  if (!s) throw new UserFacingError("Unknown scope.");
  return s;
}

export async function listScopes(organizationId: string) {
  const scopes = await db
    .select()
    .from(accessScopes)
    .where(eq(accessScopes.organizationId, organizationId))
    .orderBy(asc(accessScopes.name));
  const members = await db.execute<{ scopeId: string; email: string }>(
    sql`select sm.scope_id as "scopeId", u.email from access_scope_members sm join "user" u on u.id = sm.user_id
         where sm.organization_id = ${organizationId} order by u.email`,
  );
  return scopes.map((s) => ({
    ...s,
    members: members.rows.filter((m) => m.scopeId === s.id).map((m) => m.email),
  }));
}

export async function createScope(actor: Actor, name: string) {
  const [row] = await db
    .insert(accessScopes)
    .values({ organizationId: actor.organizationId, name: name.trim() })
    .onConflictDoNothing()
    .returning({ id: accessScopes.id });
  if (!row) throw new UserFacingError(`"${name.trim()}" already exists.`);
  await audit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "scope.created",
    subjectType: cfg.scope?.label ?? "Scope",
    subjectId: row.id,
    summary: `Created ${name.trim()}`,
  });
  return row.id;
}

/** Adds an existing workspace member (by email) to a scope. */
export async function addToScope(actor: Actor, scopeId: string, email: string) {
  const scope = await ownScope(actor.organizationId, scopeId);
  const m = await db.execute<{ userId: string }>(
    sql`select m."userId" as "userId" from member m join "user" u on u.id = m."userId"
         where m."organizationId" = ${actor.organizationId} and lower(u.email) = ${normEmail(email)} limit 1`,
  );
  const userId = m.rows[0]?.userId;
  if (!userId) throw new UserFacingError("Invite this person first: they are not a member yet.");
  await db
    .insert(accessScopeMembers)
    .values({ scopeId, userId, organizationId: actor.organizationId })
    .onConflictDoNothing();
  await audit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "scope.member_added",
    subjectType: cfg.scope?.label ?? "Scope",
    subjectId: scopeId,
    summary: `${normEmail(email)} added to ${scope.name}`,
  });
}
