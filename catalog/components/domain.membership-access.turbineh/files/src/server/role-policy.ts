import { membershipConfig, type MembershipConfig } from "@/membership/config";

/**
 * Workspace role policy from the request (component domain.membership-access.turbineh replaces the base owner/admin/
 * member policy): the roles and permissions in src/membership/params.json. Everything calls `can()` through
 * src/server/authz.ts, so editing the params changes every page, action and component at once.
 */
export const ROLES: readonly string[] = membershipConfig.roles.map((r) => r.key);
export type Role = string;
export type Action =
  "read" | "create" | "update" | "delete" | "manage_members" | "view_audit" | "see_all_scopes";

/** Role given to a member whose stored role is unknown: the least privileged one (deny by default). */
export const DEFAULT_ROLE: Role = membershipConfig.defaultRole;

export const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  membershipConfig.roles.map((r) => [r.key, r.label]),
);

/** Pure policy over a config (unit-tested with any params). */
export function canWith(cfg: MembershipConfig, role: Role, action: Action): boolean {
  return cfg.roles.find((r) => r.key === role)?.can.includes(action) ?? false;
}

export function can(role: Role, action: Action): boolean {
  return canWith(membershipConfig, role, action);
}

/** A stored role, or the least privileged role when it is unknown. */
export function toRole(value: unknown): Role {
  return typeof value === "string" && ROLES.includes(value) ? value : DEFAULT_ROLE;
}
