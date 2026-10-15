import { membershipConfig, type MembershipConfig } from "@/membership/config";

/**
 * Workspace role policy from the request (component domain.membership-access.turbineh replaces the base owner/admin/
 * member policy): the roles and permissions in src/membership/params.json. Everything calls `can()` through
 * src/server/authz.ts, so editing the params changes every page, action and component at once.
 */
export const ROLES: readonly string[] = membershipConfig.roles.map((r) => r.key);
export type Role = string;
export type Action =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "export"
  | "configure"
  | "manage_members"
  | "view_audit"
  | "see_all_scopes";

/** Role new invitations get by default (the least privileged one). Never used for an unknown stored role. */
export const DEFAULT_ROLE: Role = membershipConfig.defaultRole;

export const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  membershipConfig.roles.map((r) => [r.key, r.label]),
);

/** Privileges the params do not list: only the workspace owner has them here (src/server/permissions.ts decides). */
const OWNER_ONLY = new Set<Action>(["approve", "export", "configure"]);

/** Pure policy over a config (unit-tested with any params). Unknown roles and unlisted actions are denied. */
export function canWith(cfg: MembershipConfig, role: Role, action: Action): boolean {
  if (OWNER_ONLY.has(action)) return role === "owner" && cfg.roles.some((r) => r.key === "owner");
  return (
    cfg.roles
      .find((r) => r.key === role)
      ?.can.includes(action as MembershipConfig["roles"][number]["can"][number]) ?? false
  );
}

export function can(role: Role, action: Action): boolean {
  return canWith(membershipConfig, role, action);
}

/**
 * A stored role, or null when it is missing or unknown: deny by default (ADR-0054). An unknown role never falls back to
 * another role; requireMember() refuses the request instead.
 */
export function toRole(value: unknown): Role | null {
  return typeof value === "string" && ROLES.includes(value) ? value : null;
}
