import { createHmac, timingSafeEqual } from "node:crypto";

/** Pure billing rules (component payments.subscriptions.turbineh), unit-tested. */

/** Stripe statuses that give access to the paid plan. */
const ACTIVE = new Set(["active", "trialing"]);
export const hasPaidAccess = (plan: string, status: string) => plan === "pro" && ACTIVE.has(status);

/** Stripe-Signature check: HMAC-SHA256 of "t.body", constant-time compare, 5-minute tolerance (replay protection). */
export function verifySignature(
  raw: string,
  header: string | null,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const pairs = header.split(",").map((kv) => kv.trim().split("=") as [string, string]);
  const t = Number(pairs.find(([k]) => k === "t")?.[1]);
  if (!Number.isInteger(t) || Math.abs(now - t) > 300) return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex"),
    "hex",
  );
  return pairs
    .filter(([k]) => k === "v1")
    .some(([, v]) => {
      const got = Buffer.from(v ?? "", "hex");
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
}
