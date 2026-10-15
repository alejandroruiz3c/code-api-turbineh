import { can as roleCan, ROLE_LABEL, ROLES, type Action } from "@/server/role-policy";

/**
 * Role matrix (ADR-0044): what each workspace role may do, per action and optionally per resource, plus the sign-up
 * email-domain rule. Base behaviour: the role policy in src/server/role-policy.ts decides (template owner/admin/member,
 * or the request's roles when domain.membership-access replaced it); approving, exporting and changing settings are
 * privileges of their own, never implied by "update" or "read" (ADR-0054). TurbineH replaces this file with the request's matrix (who approves, who exports, per-resource
 * rules, "only @company emails") when the request states one. Everything calls `can()` from src/server/authz.ts,
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

/** Per-resource exceptions (resource = the entity's URL slug, e.g. "projects"): action → roles allowed. */
export const RESOURCE_RULES: Record<string, Partial<Record<Permission, readonly string[]>>> = {};

/** Sign-up restricted to these email domains ([] = no restriction; staff in ADMIN_EMAILS may always sign up). */
export const SIGN_UP_EMAIL_DOMAINS: readonly string[] = [];

/**
 * The role-policy action each permission is checked against in the base matrix. Approving, exporting and changing
 * settings are privileges of their own (never implied by "update" or "read"), so a member who may read cannot export
 * and a member who may edit cannot approve (ADR-0054).
 */
const BASE: Record<Permission, Action> = {
  read: "read",
  create: "create",
  update: "update",
  delete: "delete",
  approve: "approve",
  export: "export",
  configure: "configure",
  manage_members: "manage_members",
  view_audit: "view_audit",
  see_all_scopes: "see_all_scopes",
};

/** Whether `role` may do `action` (on `resource`, when a rule names it). Unknown roles may do nothing. */
export function allows(role: string, action: Permission, resource?: string): boolean {
  const rule = resource ? RESOURCE_RULES[resource]?.[action] : undefined;
  if (rule) return rule.includes(role);
  return ROLES.includes(role) && roleCan(role, BASE[action]);
}

/** Stored role key → what it may do (derived from the role policy). */
export const ROLE_MATRIX: Record<string, RolePermissions> = Object.fromEntries(
  ROLES.map((role) => [
    role,
    {
      label: ROLE_LABEL[role] ?? role,
      can: (Object.keys(BASE) as Permission[]).filter((a) => allows(role, a)),
      scope: { kind: "all", of: null },
    },
  ]),
);

/** Whether an email's domain may sign up under SIGN_UP_EMAIL_DOMAINS. */
export function emailDomainAllowed(
  email: string,
  domains: readonly string[] = SIGN_UP_EMAIL_DOMAINS,
): boolean {
  if (domains.length === 0) return true;
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return domains.some((d) => domain === d.toLowerCase());
}
