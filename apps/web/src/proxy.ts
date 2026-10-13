import { type NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, cookieSecret, safeEqual, verifyAccessCookie } from "./server/access-token";

/**
 * Pages anyone can read without the invitation: /use explains how to get in and how to use the product (no data, no
 * token). Exact paths only — everything else stays behind the gate.
 */
export const PUBLIC_PAGES: ReadonlySet<string> = new Set(["/use"]);

/**
 * Agent-readable catalogue index (ADR-0032) — static files in public/catalog. Same access as /v1/capabilities
 * (ADR-0030): the invitation token as `Authorization: Bearer`, or the browser cookie. API callers get a 401 problem,
 * never a redirect to an HTML page.
 */
export const CATALOG_INDEX: ReadonlySet<string> = new Set([
  "/catalog/index.json",
  "/catalog/llms.txt",
]);

const unauthorized = () =>
  NextResponse.json(
    {
      type: "about:blank",
      title: "No valid access token.",
      status: 401,
      code: "unauthorized",
      message: "No valid access token.",
      action: "Send Authorization: Bearer <your invitation token> (TURBINEH_TOKEN).",
    },
    {
      status: 401,
      headers: {
        "Content-Type": "application/problem+json",
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Bearer realm="turbineh"',
      },
    },
  );

/**
 * Optimistic gate (ADR-0030): pages need the invitation cookie, otherwise they go to /access. Route handlers check
 * access again on the server (getCaller); the API authenticates itself with `Authorization: Bearer`.
 */
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC_PAGES.has(path)) return NextResponse.next();
  const token = process.env.PRODUCT_ACCESS_TOKEN ?? "";
  if (CATALOG_INDEX.has(path)) {
    const authz = req.headers.get("authorization");
    if (authz !== null) {
      const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
      return token && bearer && safeEqual(bearer, token) ? NextResponse.next() : unauthorized();
    }
  }
  const secret = cookieSecret(token, process.env.BETTER_AUTH_SECRET ?? "");
  const ws = token ? await verifyAccessCookie(req.cookies.get(ACCESS_COOKIE)?.value, secret) : null;
  if (ws) return NextResponse.next();
  // An agent without credentials gets an actionable 401; a browser goes to the access page.
  if (CATALOG_INDEX.has(path) && !(req.headers.get("accept") ?? "").includes("text/html"))
    return unauthorized();
  const url = req.nextUrl.clone();
  url.pathname = "/access";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the access page, the API (Bearer), health, OAuth callbacks, GitHub connect (own checks), the CLI installer and static files.
  matcher: [
    "/((?!access|api/access|api/auth|api/github/|v1/|health|install\\.sh|cli/|_next/|icon|favicon|opengraph-image|robots\\.txt).*)",
  ],
};
