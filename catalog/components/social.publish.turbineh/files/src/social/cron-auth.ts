import { timingSafeEqual } from "node:crypto";

/**
 * Shared secret of the social runner routes (social.publish / social.metrics): header `x-cron-secret: <CRON_SECRET>`
 * or `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends), compared in constant time. Without a secret of at
 * least 32 characters the routes are disabled.
 */
export function cronSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.CRON_SECRET ?? "";
  return s.length >= 32 ? s : null;
}

export function cronAuthorized(req: Request, secret = cronSecret()): boolean {
  if (!secret) return false;
  const given = Buffer.from(
    req.headers.get("x-cron-secret") ??
      (req.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
  );
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** 503 without a secret, 401 with a wrong one, null when the call may run. */
export function cronRefusal(req: Request): Response | null {
  if (!cronSecret())
    return Response.json(
      { error: "Social runner is not configured (CRON_SECRET)" },
      { status: 503 },
    );
  if (!cronAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
