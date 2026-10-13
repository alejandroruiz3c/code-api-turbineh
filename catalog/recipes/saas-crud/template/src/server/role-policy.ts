import { allows, ROLE_MATRIX } from "@/server/permissions";

/**
 * Workspace role policy (Security Pack): which role may do what. The base policy reads the role matrix in
 * src/server/permissions.ts (owner/admin/member, with the rights the request gave them); the component
 * domain.membership-access.turbineh replaces this file with the roles of the request (owner/editor/viewer,
 * manager/member, staff/client…). Everything else calls `can()` from src/server/authz.ts, so one file decides.
 */
export const ROLES: readonly string[] = Object.keys(ROLE_MATRIX);
export type Role = string;
export type Action =
  "read" | "create" | "update" | "delete" | "manage_members" | "view_audit" | "see_all_scopes";

/** Role given to a member whose stored role is unknown: the least privileged one (deny by default). */
export const DEFAULT_ROLE: Role = "member";

/** Role labels for screens. */
export const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(ROLE_MATRIX).map(([key, r]) => [key, r.label]),
);

/** What the role matrix lets this role do (template: members read and create; owners and admins everything). */
export function can(role: Role, action: Action): boolean {
  return allows(role, action);
}

/** A stored role, or the least privileged role when it is unknown. */
export function toRole(value: unknown): Role {
  return typeof value === "string" && ROLES.includes(value) ? value : DEFAULT_ROLE;
}
