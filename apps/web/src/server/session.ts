import { headers } from "next/headers";
import { auth } from "./auth";

export async function currentUser(): Promise<{
  id: string;
  name: string;
  image: string | null;
} | null> {
  // Read request headers first: this marks the route dynamic before any runtime config is touched.
  const h = await headers();
  const s = await auth.api.getSession({ headers: h });
  return s ? { id: s.user.id, name: s.user.name, image: s.user.image ?? null } : null;
}
