/**
 * Workspace role policy (Security Pack): which role may do what. The base policy is owner/admin/member; the component
 * domain.membership-access.turbineh replaces this file with the roles of the request (owner/editor/viewer,
 * manager/member, staff/client…). Everything else calls `can()` from src/server/authz.ts, so one file decides.
 */
export const ROLES: readonly string[] = ["owner", "admin", "member"];
export type Role = string;
export type Action =
  "read" | "create" | "update" | "delete" | "manage_members" | "view_audit" | "see_all_scopes";

/** Role given to a member whose stored role is unknown: the least privileged one (deny by default). */
export const DEFAULT_ROLE: Role = "member";

/** Role labels for screens. */
export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/** Members read and create; owners and admins also update, delete, manage members and read the audit log. */
export function can(role: Role, action: Action): boolean {
  if (role === "owner" || role === "admin") return true;
  return role === "member" && (action === "read" || action === "create");
}

/** A stored role, or the least privileged role when it is unknown. */
export function toRole(value: unknown): Role {
  return typeof value === "string" && ROLES.includes(value) ? value : DEFAULT_ROLE;
}
