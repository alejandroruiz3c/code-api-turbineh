import { verifyApiKey } from "@turbineh/db";
import { cookies, headers } from "next/headers";
import {
  ACCESS_COOKIE,
  cookieSecret,
  safeEqual,
  verifyAccessCookie,
  WORKSPACE_HEADER,
  WORKSPACE_RE,
} from "./access-token";
import { auth } from "./auth";
import { db } from "./db";
import { env } from "./env";

export type Caller =
  | { kind: "access"; ownerId: string; workspaceId: string }
  | { kind: "session"; ownerId: string; userId: string; name: string; email: string }
  | { kind: "api-key"; ownerId: string; apiKeyId: string; dailyQuota: number };

/** API key (Authorization: Bearer tbh_…) or browser session. */
export async function getCaller(): Promise<Caller | null> {
  const h = await headers();
  const authz = h.get("authorization");
  if (authz?.startsWith("Bearer ")) {
    const bearer = authz.slice(7).trim();
    // Invitation token used as API key (ADR-0030); the workspace header keeps each CLI/project apart.
    if (safeEqual(bearer, env.PRODUCT_ACCESS_TOKEN)) {
      const ws = h.get(WORKSPACE_HEADER)?.trim().toLowerCase() ?? "";
      const workspaceId = WORKSPACE_RE.test(ws) ? ws : "api-default";
      return { kind: "access", ownerId: `invite:${workspaceId}`, workspaceId };
    }
    const key = await verifyApiKey(db, bearer);
    return key
      ? { kind: "api-key", ownerId: key.ownerId, apiKeyId: key.id, dailyQuota: key.dailyQuota }
      : null;
  }
  const ws = await verifyAccessCookie(
    (await cookies()).get(ACCESS_COOKIE)?.value,
    cookieSecret(env.PRODUCT_ACCESS_TOKEN, env.BETTER_AUTH_SECRET),
  );
  if (ws) return { kind: "access", ownerId: `invite:${ws}`, workspaceId: ws };
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
