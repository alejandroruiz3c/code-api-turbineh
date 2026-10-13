import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { auth } from "@/lib/auth";
import { isStaff, isStaffEmail } from "@/lib/staff";
import { allows, type Permission } from "@/server/permissions";
import { toRole, type Action, type Role } from "@/server/role-policy";
import { UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";

export type { Action, Permission, Role };

/**
 * Role policy (Security Pack): the role matrix in src/server/permissions.ts (roles and rules from the request when it
 * stated them; per-resource rules such as "only managers create projects" when `resource` is given).
 */
export function can(role: Role, action: Permission, resource?: string): boolean {
  return allows(role, action, resource);
}

/**
 * Signed-in user with an active organization, or a redirect. Every server action and page that reads or changes
 * workspace data goes through this (or requireAdmin()); see requireSession() and publicAction() for the other two kinds.
 */
export async function requireMember(): Promise<{
  userId: string;
  email: string;
  organizationId: string;
  role: Role;
}> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect("/sign-in");
  let organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    // Sessions without an active workspace (e.g. created before the user joined one): resume their first workspace.
    // New sign-ins get it from the session hook in src/lib/auth.ts.
    const [first] = await auth.api.listOrganizations({ headers: h });
    if (!first) redirect("/sign-up?step=organization");
    try {
      await auth.api.setActiveOrganization({ headers: h, body: { organizationId: first.id } });
    } catch {
      // Rendering a page cannot write cookies; the session row is updated, the next request reads it.
    }
    organizationId = first.id;
  }
  const member = await auth.api.getActiveMember({ headers: h }).catch(() => null);
  const role = toRole(member?.role);
  return { userId: session.user.id, email: session.user.email, organizationId, role };
}

/**
 * Signed-in user who need not be a member of any workspace yet, or a redirect to sign-in. For server actions and pages
 * of signed-in people before membership: accepting an invitation, onboarding, creating a first workspace. Anything that
 * reads or changes workspace data uses requireMember() instead.
 */
export async function requireSession(): Promise<{
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
}> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const { id, email, name, emailVerified } = session.user;
  return { userId: id, email: email.toLowerCase(), name, emailVerified: Boolean(emailVerified) };
}

/** Client address for per-IP limits: the first X-Forwarded-For hop (set by the hosting proxy), else X-Real-IP. */
export function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "local";
}

/** Why a public action refused a request before running: invalid input or too many attempts from one address. */
export type PublicRefusal = "invalid" | "rate-limited";

export interface PublicActionOptions<S extends z.ZodType, R> {
  /** Attempts allowed per client IP and window (mandatory: public actions are the first target of abuse). */
  rateLimit: { limit: number; windowMs?: number };
  /** Zod schema of the input (FormData fields or a plain object); unknown fields are dropped by z.object. */
  schema: S;
  /** The value returned to the visitor when refused (e.g. a form state); default: a UserFacingError is thrown. */
  refuse?: (reason: PublicRefusal, issues: z.core.$ZodIssue[]) => R;
}

/**
 * The one blessed way to expose a server action to anonymous visitors (public booking, contact form, waitlist,
 * accepting an emailed link): every call is rate-limited per client IP, then validated with the Zod schema, and only
 * then reaches `handler` with the parsed input. Works with `<form action>` and `useActionState` (the FormData is the
 * last argument). Export it from a "use server" file:
 *
 *   export const joinWaitlist = publicAction("waitlist", { rateLimit: { limit: 5 }, schema }, async (input) => {…});
 */
export function publicAction<S extends z.ZodType, R>(
  name: string,
  options: PublicActionOptions<S, R>,
  handler: (input: z.output<S>, ctx: { ip: string }) => Promise<R>,
): (...args: unknown[]) => Promise<R> {
  const refuse = (reason: PublicRefusal, issues: z.core.$ZodIssue[] = []): R => {
    if (options.refuse) return options.refuse(reason, issues);
    throw new UserFacingError(
      reason === "rate-limited"
        ? "Too many attempts. Try again in a minute."
        : "Check the form and try again.",
    );
  };
  return async (...args: unknown[]): Promise<R> => {
    const ip = clientIp(await headers());
    const { limit, windowMs = 60_000 } = options.rateLimit;
    if (!rateLimit(`public:${name}:${ip}`, limit, windowMs)) return refuse("rate-limited");
    const raw = args.at(-1);
    const parsed = options.schema.safeParse(
      raw instanceof FormData ? Object.fromEntries(raw) : (raw ?? {}),
    );
    if (!parsed.success) return refuse("invalid", parsed.error.issues);
    return handler(parsed.data, { ip });
  };
}

/** Staff allow-list (ADMIN_EMAILS, comma-separated emails). Deny by default: an empty list allows nobody. */
export function isAdminEmail(email: string, allowList = process.env.ADMIN_EMAILS ?? ""): boolean {
  return isStaffEmail(email, allowList);
}

/**
 * Signed-in staff user, or null. Staff = an allowlisted email the user has VERIFIED (src/lib/staff.ts): anyone can type
 * the owner's address at sign-up, only the owner can open the verification link.
 */
export async function currentAdmin(): Promise<{ userId: string; email: string } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isStaff(session.user, process.env.ADMIN_EMAILS ?? "")) return null;
  return { userId: session.user.id, email: session.user.email };
}

/** Staff-only pages and server actions: signed-in member who is verified staff (ADMIN_EMAILS), otherwise a redirect. */
export async function requireAdmin(): Promise<{
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
}> {
  const ctx = await requireMember();
  const admin = await currentAdmin();
  if (!admin) redirect("/dashboard");
  return { ...ctx, email: admin.email };
}
