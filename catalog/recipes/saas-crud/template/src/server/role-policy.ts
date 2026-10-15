/**
 * Workspace role policy (Security Pack): which role may do what. The base policy is owner/admin/member; the component
 * domain.membership-access.turbineh replaces this file with the roles of the request (owner/editor/viewer,
 * manager/member, staff/client…). Everything else calls `can()` from src/server/authz.ts, so one file decides.
 */
export const ROLES: readonly string[] = ["owner", "admin", "member"];
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

/** Role new invitations get by default: the least privileged one. Never used for an unknown stored role. */
export const DEFAULT_ROLE: Role = "member";

/** Role labels for screens. */
export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/**
 * Members read and create; owners and admins also update, delete, approve, export, change settings, manage members
 * and read the audit log. Approving, exporting and configuring are separate privileges a member never has (ADR-0054).
 */
export function can(role: Role, action: Action): boolean {
  if (role === "owner" || role === "admin") return true;
  return (
    role === "member" && (action === "read" || action === "create" || action === "see_all_scopes")
  );
}

/**
 * A stored role, or null when it is missing or unknown: deny by default (ADR-0054). An unknown role never becomes a
 * member; requireMember() refuses the request instead.
 */
export function toRole(value: unknown): Role | null {
  return typeof value === "string" && ROLES.includes(value) ? value : null;
}
