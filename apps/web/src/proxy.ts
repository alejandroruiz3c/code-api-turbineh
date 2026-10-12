import { type NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, cookieSecret, verifyAccessCookie } from "./server/access-token";

/**
 * Optimistic gate (ADR-0030): pages need the invitation cookie, otherwise they go to /access. Route handlers check
 * access again on the server (getCaller); the API authenticates itself with `Authorization: Bearer`.
 */
export async function proxy(req: NextRequest) {
  const token = process.env.PRODUCT_ACCESS_TOKEN ?? "";
  const secret = cookieSecret(token, process.env.BETTER_AUTH_SECRET ?? "");
  const ws = token ? await verifyAccessCookie(req.cookies.get(ACCESS_COOKIE)?.value, secret) : null;
  if (ws) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/access";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the access page, the API (Bearer), health, OAuth callbacks, the CLI installer and static files.
  matcher: [
    "/((?!access|api/access|api/auth|v1/|health|install\\.sh|cli/|_next/|icon|favicon|opengraph-image|robots\\.txt).*)",
  ],
};
