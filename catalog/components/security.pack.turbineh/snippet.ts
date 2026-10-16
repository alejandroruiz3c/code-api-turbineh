// A route handler in the app (e.g. src/app/api/contact/route.ts) using the Security Pack modules.
import { clientIp } from "@/security/client-ip";
import { UserFacingError, toUserMessage } from "@/security/errors";
import { securityHeaders } from "@/security/headers";
import { rateLimit } from "@/security/rate-limit";

export async function POST(req: Request): Promise<Response> {
  if (!(await rateLimit(`contact:${clientIp(req.headers)}`, 5, 60_000)))
    return new Response("Too many attempts. Try again in a minute.", { status: 429 });
  try {
    const body = (await req.json()) as { message?: unknown };
    if (typeof body.message !== "string") throw new UserFacingError("Write a message.");
    return Response.json({ ok: true });
  } catch (err) {
    // Users see the UserFacingError message or a generic one; internals go to server logs only.
    return Response.json({ ok: false, error: toUserMessage(err) }, { status: 400 });
  }
}

// next.config.ts applies these headers (CSP, HSTS, frame-ancestors…) to every route.
export const headers = securityHeaders();
