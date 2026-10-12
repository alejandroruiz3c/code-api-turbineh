import { cookies } from "next/headers";
import {
  ACCESS_COOKIE,
  cookieSecret,
  newWorkspaceId,
  safeEqual,
  signAccessCookie,
  verifyAccessCookie,
} from "@/server/access-token";
import { env } from "@/server/env";

/** Same-site paths only ("/flows?x=1"), never "//host" or absolute URLs. */
const safeNext = (v: FormDataEntryValue | null) =>
  typeof v === "string" && /^\/(?![/\\])[\w\-/?=&%.]*$/.test(v) && v.length <= 300 ? v : "/";

/** POST /api/access — invitation token → signed workspace cookie (30 days). The token itself is never stored. */
export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const token = String(form.get("token") ?? "").trim();
  const next = safeNext(form.get("next"));
  const back = (q: string) => Response.redirect(new URL(`/access?${q}`, req.url), 303);
  if (!token || !safeEqual(token, env.PRODUCT_ACCESS_TOKEN)) {
    return back(`error=1&next=${encodeURIComponent(next)}`);
  }
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
  return Response.redirect(new URL(next, req.url), 303);
}

/** DELETE /api/access — leave (clears the cookie). */
export async function DELETE(): Promise<Response> {
  (await cookies()).delete(ACCESS_COOKIE);
  return new Response(null, { status: 204 });
}
