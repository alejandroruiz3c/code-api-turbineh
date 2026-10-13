import { z } from "zod";
import params from "./params.json";

/**
 * Membership parameters (component domain.membership-access.turbineh), written by TurbineH from the request: the
 * workspace roles and what each may do (owner/editor/viewer, manager/member, staff/client…), the role unknown values
 * fall back to, the roles that can be granted by invitation, how long an invitation lasts and the optional per-record
 * scope (company, project, shop…). Validated at start-up: a wrong value fails loudly.
 */
export const ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "manage_members",
  "view_audit",
  "see_all_scopes",
] as const;

const key = z.string().regex(/^[a-z][a-z0-9_]{0,23}$/, "lowercase role key");

export const MembershipParams = z
  .object({
    roles: z
      .array(
        z.object({
          key,
          label: z.string().trim().min(1).max(40),
          can: z.array(z.enum(ACTIONS)).max(ACTIONS.length),
        }),
      )
      .min(2)
      .max(8),
    defaultRole: key,
    inviteRoles: z.array(key).min(1).max(8),
    invitationDays: z.number().int().min(1).max(30),
    scope: z
      .object({
        kind: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/),
        label: z.string().trim().min(1).max(40),
        plural: z.string().trim().min(1).max(40),
      })
      .nullable(),
  })
  .superRefine((p, ctx) => {
    const keys = p.roles.map((r) => r.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", path: ["roles"], message: "role keys must be unique" });
    // Whoever creates a workspace is its owner (better-auth): the owner role must exist and manage members.
    const owner = p.roles.find((r) => r.key === "owner");
    if (!owner || !owner.can.includes("manage_members"))
      ctx.addIssue({
        code: "custom",
        path: ["roles"],
        message: "an owner role that manages members is required",
      });
    for (const [path, k] of [
      ["defaultRole", p.defaultRole],
      ...p.inviteRoles.map((r) => ["inviteRoles", r] as const),
    ] as const)
      if (!keys.includes(k))
        ctx.addIssue({ code: "custom", path: [path], message: `unknown role ${k}` });
  });

export type MembershipConfig = z.infer<typeof MembershipParams>;
export type Permission = (typeof ACTIONS)[number];

export const membershipConfig: MembershipConfig = MembershipParams.parse(params);
