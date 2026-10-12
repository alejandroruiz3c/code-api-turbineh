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

/** "21" / "21.5" / "7,75" % → basis points (2100, 2150, 775); null outside 0–100 %. */
export function parseRatePercent(input: string): number | null {
  const m = /^\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  return bp <= 10_000 ? bp : null;
}

export const formatRate = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, "")} %`;

/** "es, PT ,fr" → ["ES","PT","FR"] (unique, ISO 3166-1 alpha-2 shape); null if any entry is malformed. */
export function parseCountries(input: string): string[] | null {
  const codes = input
    .split(/[\s,;]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (codes.some((c) => !/^[A-Z]{2}$/.test(c))) return null;
  return [...new Set(codes)];
}

export interface ShippingRate {
  id: string;
  name: string;
  countries: string;
  priceCents: number;
  freeOverCents: number | null;
}

/** A rate ships to a country when its list is empty (everywhere) or contains the country. */
export function shipsTo(rate: Pick<ShippingRate, "countries">, country: string): boolean {
  const list = parseCountries(rate.countries) ?? [];
  return list.length === 0 || list.includes(country.toUpperCase());
}

/** Shipping price for a cart subtotal: free from `freeOverCents` (inclusive) when set. */
export function shippingCost(rate: ShippingRate, subtotalCents: number): number {
  return rate.freeOverCents !== null && subtotalCents >= rate.freeOverCents ? 0 : rate.priceCents;
}

/** Tax rate for a country: its own rate, else the "*" default, else none. */
export function taxFor<T extends { country: string }>(rates: T[], country: string): T | null {
  return (
    rates.find((r) => r.country === country.toUpperCase()) ??
    rates.find((r) => r.country === "*") ??
    null
  );
}

/** Integer division rounded half up (amounts are never negative). */
const divRound = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));

export interface Totals {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * Order totals in integer cents. Tax applies to goods and shipping together and is computed once on that sum
 * (not per line), rounded half up to the cent:
 * - prices exclude tax: tax = round(base × rate), total = base + tax;
 * - prices include tax: total = base, tax = base − round(base ÷ (1 + rate)) (the tax contained in the price).
 */
export function orderTotals(input: {
  subtotalCents: number;
  shippingCents: number;
  rateBp: number;
  pricesIncludeTax: boolean;
}): Totals {
  const { subtotalCents, shippingCents, rateBp } = input;
  const base = subtotalCents + shippingCents;
  if (input.pricesIncludeTax) {
    const taxCents = base - divRound(base * 10_000, 10_000 + rateBp);
    return { subtotalCents, shippingCents, taxCents, totalCents: base };
  }
  const taxCents = divRound(base * rateBp, 10_000);
  return { subtotalCents, shippingCents, taxCents, totalCents: base + taxCents };
}

/** Plain-text order breakdown for emails: lines, subtotal, shipping, tax and total. */
export function orderSummary(
  order: {
    currency: string;
    subtotalCents: number;
    shippingCents: number;
    shippingName: string | null;
    taxCents: number;
    taxLabel: string | null;
    pricesIncludeTax: boolean;
    totalCents: number;
  },
  items: { name: string; variantName: string | null; quantity: number; unitPriceCents: number }[],
): string {
  const money = (c: number) => formatPrice(c, order.currency);
  return [
    ...items.map(
      (i) =>
        `${i.quantity} × ${i.variantName ? `${i.name} — ${i.variantName}` : i.name}: ${money(i.unitPriceCents * i.quantity)}`,
    ),
    "",
    `Subtotal: ${money(order.subtotalCents)}`,
    ...(order.shippingName
      ? [
          `Shipping (${order.shippingName}): ${order.shippingCents === 0 ? "Free" : money(order.shippingCents)}`,
        ]
      : []),
    ...(order.taxLabel
      ? [`${order.pricesIncludeTax ? "Includes " : ""}${order.taxLabel}: ${money(order.taxCents)}`]
      : []),
    `Total: ${money(order.totalCents)}`,
  ].join("\n");
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
