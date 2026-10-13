import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type Role = "owner" | "admin" | "member";
export type Action = "read" | "create" | "update" | "delete";

/** Role policy (Security Pack): members read and create; only owners and admins update or delete. */
export function can(role: Role, action: Action): boolean {
  if (role === "owner" || role === "admin") return true;
  return action === "read" || action === "create";
}

/** Signed-in user with an active organization, or a redirect. Every server action and page goes through this. */
export async function requireMember(): Promise<{
  userId: string;
  organizationId: string;
  role: Role;
}> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect("/sign-in");
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/sign-up?step=organization");
  const member = await auth.api.getActiveMember({ headers: h });
  const role = (member?.role ?? "member") as Role;
  return { userId: session.user.id, organizationId, role };
}

/** Staff allow-list (ADMIN_EMAILS, comma-separated emails). Deny by default: an empty list allows nobody. */
export function isAdminEmail(email: string, allowList = process.env.ADMIN_EMAILS ?? ""): boolean {
  const e = email.trim().toLowerCase();
  return (
    e.length > 0 &&
    allowList
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .some((a) => a === e)
  );
}

/** Signed-in user whose email is on the staff allow-list, or null. */
export async function currentAdmin(): Promise<{ userId: string; email: string } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) return null;
  return { userId: session.user.id, email: session.user.email };
}

/** Staff-only server actions: signed-in member on the ADMIN_EMAILS allow-list, otherwise a redirect. */
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
