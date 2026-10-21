import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { toRole } from "@/server/role-policy";
import type { Actor } from "./service";

/**
 * The caller of a matching API route: a signed-in member of their active organization, or null (the route answers
 * 401). Same checks as requireMember(), without redirects: deny by default, unknown roles refused.
 */
export async function apiMember(): Promise<Actor | null> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  const organizationId = session?.session.activeOrganizationId;
  if (!session || !organizationId) return null;
  let member: { role?: unknown; organizationId?: unknown } | null;
  try {
    member = await auth.api.getActiveMember({ headers: h });
  } catch {
    return null;
  }
  if (!member || (member.organizationId !== undefined && member.organizationId !== organizationId))
    return null;
  const role = toRole(member.role);
  if (!role) return null;
  return { userId: session.user.id, email: session.user.email, organizationId, role };
}

/** JSON answers of the matching API (never cached: data of one organization). */
export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
