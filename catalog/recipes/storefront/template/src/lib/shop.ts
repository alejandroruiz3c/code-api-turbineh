import { createHmac, timingSafeEqual } from "node:crypto";

/** Pure shop rules (no environment, unit-tested). */

export const MAX_QTY = 20;
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export function formatPrice(cents: number, currency: string, locale = "en-GB"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/** "12.50" / "12,50" → 1250 cents; null when not a valid, positive amount. */
export function parsePrice(input: string): number | null {
  const m = /^\s*(\d{1,7})(?:[.,](\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  return cents > 0 ? cents : null;
}

export function cartTotal(lines: { unitPriceCents: number; quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
}

/** Product image type from its content (PNG, JPEG, WebP), never from the name. */
export function imageType(bytes: Uint8Array): string | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/**
 * Stripe webhook signature (header `Stripe-Signature: t=…,v1=…`): HMAC-SHA256 of `${t}.${rawBody}` with the endpoint
 * secret, compared in constant time; events older than `toleranceSec` are rejected (replay protection).
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as const;
    }),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const signatures = header
    .split(",")
    .filter((kv) => kv.trim().startsWith("v1="))
    .map((kv) => kv.trim().slice(3));
  return signatures.some((sig) => {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** Test helper and documentation of the scheme: builds a valid header for a payload. */
export function signStripePayload(
  rawBody: string,
  secret: string,
  t = Math.floor(Date.now() / 1000),
): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}
