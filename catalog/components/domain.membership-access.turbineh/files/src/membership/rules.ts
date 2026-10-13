import { createHash, randomBytes } from "node:crypto";
import type { MembershipConfig } from "./config";

/**
 * Membership rules (component domain.membership-access.turbineh): pure functions, unit-tested. The service and the
 * pages call them; nothing else decides who may invite, change a role or accept an invitation.
 */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A link token (shown once, in the email) and the hash that is stored. */
export function newInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export const normEmail = (e: string) => e.trim().toLowerCase();

/** Roles `inviterRole` may grant: the invitable roles, and "owner" only when the inviter is an owner. */
export function grantableRoles(cfg: MembershipConfig, inviterRole: string): string[] {
  const inviter = cfg.roles.find((r) => r.key === inviterRole);
  if (!inviter?.can.includes("manage_members")) return [];
  const roles = cfg.roles.map((r) => r.key).filter((k) => cfg.inviteRoles.includes(k));
  return inviterRole === "owner" && !roles.includes("owner") ? [...roles, "owner"] : roles;
}

/** Why a role change is refused, or null: never your own role, never the last owner, only grantable roles. */
export function roleChangeError(input: {
  cfg: MembershipConfig;
  actorRole: string;
  actorUserId: string;
  targetUserId: string;
  targetRole: string;
  /** null = remove the member. */
  newRole: string | null;
  owners: number;
}): string | null {
  if (input.actorUserId === input.targetUserId) return "You cannot change your own membership.";
  if (input.targetRole === "owner" && input.actorRole !== "owner")
    return "Only an owner can change another owner.";
  if (input.targetRole === "owner" && input.newRole !== "owner" && input.owners <= 1)
    return "A workspace needs at least one owner.";
  if (input.newRole !== null && !grantableRoles(input.cfg, input.actorRole).includes(input.newRole))
    return "You cannot give that role.";
  return null;
}

export type InvitationCheck =
  { ok: true } | { ok: false; reason: "invalid" | "expired" | "used" | "wrong-email" };

/** An invitation is accepted once, before it expires, only by a person signed in with the invited email. */
export function checkInvitation(
  inv: { status: string; expiresAt: Date; email: string } | null,
  signedInEmail: string,
  now = new Date(),
): InvitationCheck {
  if (!inv || inv.status === "revoked") return { ok: false, reason: "invalid" };
  if (inv.status !== "pending") return { ok: false, reason: "used" };
  if (inv.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (normEmail(inv.email) !== normEmail(signedInEmail))
    return { ok: false, reason: "wrong-email" };
  return { ok: true };
}

/** A role that sees only the scopes it belongs to needs one when it is invited (otherwise it would see nothing). */
export function needsScope(cfg: MembershipConfig, role: string): boolean {
  if (!cfg.scope) return false;
  return !(cfg.roles.find((r) => r.key === role)?.can.includes("see_all_scopes") ?? false);
}
