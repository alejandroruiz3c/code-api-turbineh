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
