import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isStaffEmail } from "@/lib/staff";
import { requireMember } from "@/server/authz";

/** Global data (site content, products, orders, waitlist): only staff emails (ADMIN_EMAILS) may manage it. */
export async function requireAdmin(): Promise<void> {
  await requireMember();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isStaffEmail(session.user.email)) redirect("/dashboard");
}
