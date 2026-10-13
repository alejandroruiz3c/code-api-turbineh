/**
 * Role matrix (ADR-0043): what each workspace role may do, per action and optionally per resource, plus the sign-up
 * email-domain rule. Base behaviour: the template policy (owners and admins do everything; members read, create and
 * export). TurbineH replaces this file with the matrix of the request (roles, read-only roles, who approves, who
 * exports, "only @company emails") when the request states one. Everything calls `can()` from src/server/authz.ts,
 * which asks `allows()` here, so one file decides.
 */
export type Permission =
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

export interface RolePermissions {
  label: string;
  can: readonly Permission[];
  /** all: the whole workspace; own / membership: only records of their own <of> (src/server/record-access.ts). */
  scope: { kind: "all" | "own" | "membership"; of: string | null };
}

const EVERYTHING: readonly Permission[] = [
  "read",
  "create",
  "update",
  "delete",
  "approve",
  "export",
  "configure",
  "manage_members",
  "view_audit",
  "see_all_scopes",
];

/** Stored role key → what it may do. */
export const ROLE_MATRIX: Record<string, RolePermissions> = {
  owner: { label: "Owner", can: EVERYTHING, scope: { kind: "all", of: null } },
  admin: { label: "Admin", can: EVERYTHING, scope: { kind: "all", of: null } },
  member: {
    label: "Member",
    can: ["read", "create", "export"],
    scope: { kind: "all", of: null },
  },
};

/** Per-resource exceptions (resource = the entity's URL slug, e.g. "projects"): action → roles allowed. */
export const RESOURCE_RULES: Record<string, Partial<Record<Permission, readonly string[]>>> = {};

/** Sign-up restricted to these email domains ([] = no restriction; staff in ADMIN_EMAILS may always sign up). */
export const SIGN_UP_EMAIL_DOMAINS: readonly string[] = [];

/** Whether `role` may do `action` (on `resource`, when the matrix has a rule for it). Unknown roles may do nothing. */
export function allows(role: string, action: Permission, resource?: string): boolean {
  const rule = resource ? RESOURCE_RULES[resource]?.[action] : undefined;
  if (rule) return rule.includes(role);
  return ROLE_MATRIX[role]?.can.includes(action) ?? false;
}

/** Whether an email's domain may sign up under SIGN_UP_EMAIL_DOMAINS. */
export function emailDomainAllowed(
  email: string,
  domains: readonly string[] = SIGN_UP_EMAIL_DOMAINS,
): boolean {
  if (domains.length === 0) return true;
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return domains.some((d) => domain === d.toLowerCase());
}
