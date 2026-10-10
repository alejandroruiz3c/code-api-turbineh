import { headers } from "next/headers";
import { auth } from "./auth";

export async function currentUser(): Promise<{
  id: string;
  name: string;
  image: string | null;
} | null> {
  const s = await auth.api.getSession({ headers: await headers() });
  return s ? { id: s.user.id, name: s.user.name, image: s.user.image ?? null } : null;
}
