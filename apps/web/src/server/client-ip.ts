import { createHmac } from "node:crypto";
import { env } from "./env";

/**
 * Client IP as set by Vercel's edge (not spoofable by the client there), hashed with a server secret: the per-IP
 * quota (PLAN §9) counts builds without storing any IP address.
 */
export function clientIpHash(headers: Headers): string | null {
  const ip =
    headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!ip) return null;
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`ip-quota:${ip}`).digest("base64url");
}
