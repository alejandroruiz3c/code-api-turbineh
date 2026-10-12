import { verifyApiKey } from "@turbineh/db";
import { headers } from "next/headers";
import { auth } from "./auth";
import { db } from "./db";

export type Caller =
  | { kind: "session"; ownerId: string; userId: string; name: string; email: string }
  | { kind: "api-key"; ownerId: string; apiKeyId: string; dailyQuota: number };

/** API key (Authorization: Bearer tbh_…) or browser session. */
export async function getCaller(): Promise<Caller | null> {
  const h = await headers();
  const authz = h.get("authorization");
  if (authz?.startsWith("Bearer ")) {
    const key = await verifyApiKey(db, authz.slice(7).trim());
    return key
      ? { kind: "api-key", ownerId: key.ownerId, apiKeyId: key.id, dailyQuota: key.dailyQuota }
      : null;
  }
  const session = await auth.api.getSession({ headers: h });
  return session
    ? {
        kind: "session",
        ownerId: `user:${session.user.id}`,
        userId: session.user.id,
        name: session.user.name,
        email: session.user.email,
      }
    : null;
}
