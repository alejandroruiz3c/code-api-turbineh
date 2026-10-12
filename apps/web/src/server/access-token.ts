/**
 * Invitation access (PLAN §16, ADR-0030): software.turbineh.com is only the product area and opens with an access
 * token (no login). The browser keeps a signed cookie with a random workspace id — never the token itself. Web Crypto
 * only, so the same code runs in proxy.ts and in route handlers.
 */
export const ACCESS_COOKIE = "tbh_access";
export const WORKSPACE_HEADER = "x-turbineh-workspace";
export const WORKSPACE_RE = /^[a-z0-9-]{8,64}$/;

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Constant-time string comparison (length is not secret here: both sides are fixed-format values). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Signing secret: rotating the access token (or the auth secret) invalidates every cookie. */
export const cookieSecret = (accessToken: string, authSecret: string) =>
  `${accessToken}\u0000${authSecret}`;

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function signAccessCookie(workspaceId: string, secret: string): Promise<string> {
  if (!WORKSPACE_RE.test(workspaceId)) throw new Error("invalid workspace id");
  return `${workspaceId}.${await hmac(secret, `access:${workspaceId}`)}`;
}

/** The workspace id of a valid cookie, otherwise null. */
export async function verifyAccessCookie(
  value: string | undefined,
  secret: string,
): Promise<string | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  const ws = value.slice(0, dot);
  if (dot < 0 || !WORKSPACE_RE.test(ws)) return null;
  return safeEqual(value.slice(dot + 1), await hmac(secret, `access:${ws}`)) ? ws : null;
}

export const newWorkspaceId = () => crypto.randomUUID();
