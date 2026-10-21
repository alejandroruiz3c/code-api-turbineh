import { normalizeEmail, setWorkspaceContact } from "@turbineh/db";
import { createLogger } from "@turbineh/shared";
import { cookies } from "next/headers";
import {
  ACCESS_COOKIE,
  cookieSecret,
  newWorkspaceId,
  safeEqual,
  signAccessCookie,
  verifyAccessCookie,
} from "@/server/access-token";
import { db } from "@/server/db";
import { env } from "@/server/env";

const log = createLogger("access");

/** Same-site paths only ("/flows?x=1"), never "//host" or absolute URLs. */
const safeNext = (v: FormDataEntryValue | null) =>
  typeof v === "string" && /^\/(?![/\\])[\w\-/?=&%.]*$/.test(v) && v.length <= 300 ? v : "/";

/**
 * POST /api/access — invitation token + email → signed workspace cookie (30 days). The token itself is never stored;
 * the email becomes the workspace's contact email (ADR-0074), used to tell the person when something they asked for
 * that the library doesn't cover yet becomes available.
 */
export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const token = String(form.get("token") ?? "").trim();
  const rawEmail = String(form.get("email") ?? "").slice(0, 300);
  const email = normalizeEmail(rawEmail);
  const next = safeNext(form.get("next"));
  // Never the token nor the email in the URL (logs, history): only which field was wrong.
  const back = (error: "token" | "email") =>
    Response.redirect(
      new URL(`/access?error=${error}&next=${encodeURIComponent(next)}`, req.url),
      303,
    );
  if (!token || !safeEqual(token, env.PRODUCT_ACCESS_TOKEN)) return back("token");
  if (!email) return back("email");
  const secret = cookieSecret(env.PRODUCT_ACCESS_TOKEN, env.BETTER_AUTH_SECRET);
  const jar = await cookies();
  const ws = (await verifyAccessCookie(jar.get(ACCESS_COOKIE)?.value, secret)) ?? newWorkspaceId();
  jar.set(ACCESS_COOKIE, await signAccessCookie(ws, secret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  // Entering never fails because of the email: if it cannot be stored now, the app asks for it again.
  await setWorkspaceContact(db, `invite:${ws}`, email).catch((err: unknown) => {
    log.error("workspace contact not stored", {
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    });
  });
  return Response.redirect(new URL(next, req.url), 303);
}

/** DELETE /api/access — leave (clears the cookie). */
export async function DELETE(): Promise<Response> {
  (await cookies()).delete(ACCESS_COOKIE);
  return new Response(null, { status: 204 });
}
