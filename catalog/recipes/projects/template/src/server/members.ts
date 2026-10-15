import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/** Members of the active workspace (for assignee pickers and names). */
export async function workspaceMembers(): Promise<
  { userId: string; name: string; email: string }[]
> {
  const res = await auth.api.listMembers({ headers: await headers() }).catch(() => null);
  return (res?.members ?? []).map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
  }));
}
