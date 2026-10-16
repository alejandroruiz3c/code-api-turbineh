import { type NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  cookieSecret,
  safeEqual,
  verifyAccessCookie,
  WORKSPACE_HEADER,
  WORKSPACE_RE,
} from "./server/access-token";

/**
 * Pages anyone can read without the invitation (ADR-0038): /use explains how to get in and how to use the product (no data, no
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

const apiProblem = (status: number, code: string, message: string, action: string) =>
  NextResponse.json(
    { type: "about:blank", title: message, status, code, message, action },
    { status, headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store" } },
  );

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Same-site HTML form posts with their own Origin check (ADR-0061). */
const FORM_POSTS: ReadonlySet<string> = new Set(["/v1/ops/owner-report/send"]);

/**
 * API guard for /v1 (audit I-6, I-7), before any route handler:
 *  - `x-turbineh-workspace`, when sent, must be a workspace id (lowercase letters, digits and dashes, 8–64 chars; the
 *    CLI sends a random UUID). Anything else is a 400 instead of silently falling back to the shared workspace. With
 *    the browser cookie the workspace is the cookie's own (one workspace per browser); the header only selects a
 *    workspace with `Authorization: Bearer <invitation token>`.
 *  - CSRF: a mutating request authenticated by cookie (no Authorization header) must be `Content-Type:
 *    application/json` — a cross-site form or `text/plain` fetch cannot set it without a CORS preflight, which is
 *    refused. 415 otherwise. Session cookies are also SameSite=Lax.
 */
export function v1Guard(req: Pick<NextRequest, "method" | "headers"> & { nextUrl: { pathname: string } }) {
  const ws = req.headers.get(WORKSPACE_HEADER);
  if (ws !== null && !WORKSPACE_RE.test(ws.trim().toLowerCase()))
    return apiProblem(
      400,
      "invalid_workspace",
      "The x-turbineh-workspace header is not a valid workspace id.",
      "Send a random UUID (what `turbineh init` writes to .turbineh/config.json) or omit the header.",
    );
  if (
    MUTATING.has(req.method.toUpperCase()) &&
    !req.headers.has("authorization") &&
    !FORM_POSTS.has(req.nextUrl.pathname)
  ) {
    const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json")
      return apiProblem(
        415,
        "unsupported_media_type",
        "Requests authenticated by the browser cookie must send Content-Type: application/json.",
        "Send the body as JSON with Content-Type: application/json (or authenticate with Authorization: Bearer).",
      );
  }
  return null;
}

/**
 * Optimistic gate (ADR-0030): pages need the invitation cookie, otherwise they go to /access. Route handlers check
 * access again on the server (getCaller); the API authenticates itself with `Authorization: Bearer`.
 */
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path.startsWith("/v1/")) return v1Guard(req) ?? NextResponse.next();
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
  // /v1 only for the API guard (v1Guard; route handlers authenticate). Everything else except the access page, health, OAuth callbacks, GitHub connect (own checks), the CLI installer and static files.
  matcher: [
    "/((?!access|api/access|api/auth|api/github/|v1/|health|install\\.sh|cli/|_next/|icon|favicon|opengraph-image|robots\\.txt).*)",
    "/v1/:path*",
  ],
};
