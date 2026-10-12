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
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * Order totals in integer cents. The discount applies to goods only; tax applies to discounted goods plus shipping,
 * computed once on that sum (not per line) and rounded half up to the cent:
 * - prices exclude tax: tax = round(base × rate), total = base + tax;
 * - prices include tax: total = base, tax = base − round(base ÷ (1 + rate)) (the tax contained in the price).
 */
export function orderTotals(input: {
  subtotalCents: number;
  discountCents?: number;
  shippingCents: number;
  rateBp: number;
  pricesIncludeTax: boolean;
}): Totals {
  const { subtotalCents, shippingCents, rateBp } = input;
  const discountCents = Math.min(Math.max(input.discountCents ?? 0, 0), subtotalCents);
  const base = subtotalCents - discountCents + shippingCents;
  if (input.pricesIncludeTax) {
    const taxCents = base - divRound(base * 10_000, 10_000 + rateBp);
    return { subtotalCents, discountCents, shippingCents, taxCents, totalCents: base };
  }
  const taxCents = divRound(base * rateBp, 10_000);
  return { subtotalCents, discountCents, shippingCents, taxCents, totalCents: base + taxCents };
}

/** Smallest card payment Stripe accepts is about 0.50 in most currencies: below it there is nothing to charge. */
export const MIN_CHARGE_CENTS = 50;

/** The shop's currencies: the base one first, then the extra ones (lower-case ISO codes, no duplicates). */
export function shopCurrencies(base: string, extras: string): string[] {
  const list = [base, ...extras.split(",")]
    .map((c) => c.trim().toLowerCase())
    .filter((c) => /^[a-z]{3}$/.test(c));
  return [...new Set(list)];
}

/** The requested currency when the shop sells in it, otherwise the base currency. */
export function pickCurrency(requested: string | null | undefined, enabled: string[]): string {
  const c = (requested ?? "").trim().toLowerCase();
  return enabled.includes(c) ? c : (enabled[0] ?? "eur");
}

/**
 * Price of a product or option in a currency. Base currency: the option's own price, else the product's.
 * Extra currency (explicit prices only, no exchange rates): the option's own price there; an option that inherits
 * the product's base price also inherits the product's price there; otherwise not sold in that currency (null).
 */
export function priceIn(p: {
  base: boolean;
  productBase: number;
  variant: boolean;
  variantBase: number | null;
  productLocal: number | null;
  variantLocal: number | null;
}): number | null {
  if (p.base) return p.variant ? (p.variantBase ?? p.productBase) : p.productBase;
  if (!p.variant) return p.productLocal;
  return p.variantLocal ?? (p.variantBase === null ? p.productLocal : null);
}

/** Discount codes are case-insensitive: stored and compared upper-case, spaces removed. */
export const normalizeCode = (input: string) => input.trim().toUpperCase().replace(/\s+/g, "");
export const COUPON_CODE = /^[A-Z0-9_-]{3,40}$/;

export interface Coupon {
  code: string;
  kind: string;
  percentBp: number | null;
  amountCents: number | null;
  currency: string | null;
  minSubtotalCents: number | null;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: Date | null;
  active: boolean;
}

/**
 * Discount of a code on a goods subtotal, or the reason it cannot be used. Percent: round half up of
 * subtotal × rate; fixed amount: in the code's currency only. Never more than the subtotal.
 */
export function couponDiscount(
  c: Coupon,
  subtotalCents: number,
  currency: string,
  now = new Date(),
): { discountCents: number } | { error: string } {
  if (!c.active) return { error: "This code is not valid." };
  if (c.expiresAt && now.getTime() >= c.expiresAt.getTime())
    return { error: "This code has expired." };
  if (c.maxRedemptions !== null && c.redemptions >= c.maxRedemptions)
    return { error: "This code has been fully used." };
  if (c.currency && c.currency !== currency)
    return { error: `This code is valid for payments in ${c.currency.toUpperCase()} only.` };
  if (c.minSubtotalCents !== null && subtotalCents < c.minSubtotalCents)
    return {
      error: `This code needs an order of at least ${formatPrice(c.minSubtotalCents, currency)}.`,
    };
  const raw =
    c.kind === "percent"
      ? divRound(subtotalCents * (c.percentBp ?? 0), 10_000)
      : c.kind === "amount"
        ? (c.amountCents ?? 0)
        : 0;
  return { discountCents: Math.min(Math.max(raw, 0), subtotalCents) };
}

/** Human description of a code, e.g. "10 % off" or "€5.00 off (from €40.00)". */
export function describeCoupon(
  c: Pick<Coupon, "kind" | "percentBp" | "amountCents" | "currency" | "minSubtotalCents">,
): string {
  const cur = c.currency ?? "";
  const off =
    c.kind === "percent"
      ? `${formatRate(c.percentBp ?? 0)} off`
      : `${cur ? formatPrice(c.amountCents ?? 0, cur) : "?"} off`;
  return c.minSubtotalCents !== null && cur
    ? `${off} (from ${formatPrice(c.minSubtotalCents, cur)})`
    : off;
}

/**
 * Amounts from Stripe's signed checkout.session.completed event (used with Stripe Tax, where Stripe computes the
 * tax): accepted only when they are whole non-negative cents in the order's currency.
 */
export function stripePaidAmounts(
  session: { amount_total?: unknown; currency?: unknown; total_details?: { amount_tax?: unknown } },
  orderCurrency: string,
): { taxCents: number; totalCents: number } | null {
  const total = session.amount_total;
  const tax = session.total_details?.amount_tax;
  const ok = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100_000_000;
  if (!ok(total) || !ok(tax) || tax > total) return null;
  if (typeof session.currency !== "string" || session.currency.toLowerCase() !== orderCurrency)
    return null;
  return { taxCents: tax, totalCents: total };
}

/** Plain-text order breakdown for emails: lines, subtotal, shipping, tax and total. */
export function orderSummary(
  order: {
    currency: string;
    subtotalCents: number;
    discountCents?: number;
    couponCode?: string | null;
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
    ...(order.discountCents
      ? [
          `Discount${order.couponCode ? ` (${order.couponCode})` : ""}: −${money(order.discountCents)}`,
        ]
      : []),
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
