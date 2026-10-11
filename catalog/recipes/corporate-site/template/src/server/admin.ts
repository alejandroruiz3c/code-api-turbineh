import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { requireMember } from "@/server/authz";

/** Website content is global: only emails listed in ADMIN_EMAILS may edit it. */
export async function requireAdmin(): Promise<void> {
  await requireMember();
  const session = await auth.api.getSession({ headers: await headers() });
  const allowed = env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!session || !allowed.includes(session.user.email.toLowerCase())) redirect("/dashboard");
}
