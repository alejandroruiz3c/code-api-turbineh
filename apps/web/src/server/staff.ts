import { headers } from "next/headers";
import { auth } from "./auth";
import { getCaller } from "./caller";
import { env } from "./env";
import { isOps } from "./ops";

const list = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

export interface Staff {
  via: "session" | "api-key";
  /** Owner id of the staff caller (for logs; never shown to clients). */
  ownerId: string;
}

/**
 * TurbineH staff for the internal pages and /v1/ops/* (ADR-0061). Same rule as `isOps` (OPS_ADMIN_EMAILS for a
 * GitHub sign-in, OPS_OWNER_IDS for an API key), with one fix: in a browser the invitation cookie wins in `getCaller`
 * (the product works per workspace), so a staff member who is also signed in with GitHub was never recognised. Here a
 * request without `Authorization` also checks the GitHub sign-in session directly. Bearer callers are judged by their
 * key only.
 */
export async function getStaff(): Promise<Staff | null> {
  const caller = await getCaller();
  if (caller && isOps(caller))
    return { via: caller.kind === "session" ? "session" : "api-key", ownerId: caller.ownerId };
  const h = await headers();
  if (h.get("authorization")) return null;
  const session = await auth.api.getSession({ headers: h }).catch(() => null);
  // Only a verified email can name a staff member (same rule as the generated apps' staff, ADR-0040).
  if (
    session?.user.emailVerified &&
    list(env.OPS_ADMIN_EMAILS).includes(session.user.email.toLowerCase())
  )
    return { via: "session", ownerId: `user:${session.user.id}` };
  return null;
}
