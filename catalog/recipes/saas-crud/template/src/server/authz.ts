import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isStaff, isStaffEmail } from "@/lib/staff";
import { can as policyCan, toRole, type Action, type Role } from "@/server/role-policy";

export type { Action, Role };

/** Role policy (Security Pack), defined in src/server/role-policy.ts (roles from the request when they were given). */
export function can(role: Role, action: Action): boolean {
  return policyCan(role, action);
}

/**
 * Signed-in user, member of a workspace or not yet (e.g. someone accepting an invitation), or a redirect to sign-in.
 * Server actions of signed-in people who may not belong to the workspace yet start with this.
 */
export async function requireSession(): Promise<{ userId: string; email: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return { userId: session.user.id, email: session.user.email };
}

/** Signed-in user with an active organization, or a redirect. Every server action and page goes through this. */
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
