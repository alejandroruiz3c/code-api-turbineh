"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { coupons } from "@/db/schema";
import { COUPON_CODE, normalizeCode, parsePrice, parseRatePercent } from "@/lib/shop";
import { UserFacingError } from "@/security/errors";
import { requireAdmin } from "@/server/admin";
import { enabledCurrencies } from "@/server/currency";

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

/**
 * Creates a discount code: percent off (any currency, or one) or a fixed amount in one currency; optional minimum
 * order, maximum uses and last valid day.
 */
export async function saveCoupon(formData: FormData): Promise<void> {
  await requireAdmin();
  const code = normalizeCode(text(formData.get("code")));
  if (!COUPON_CODE.test(code))
    throw new UserFacingError("Codes use 3–40 letters, digits, - or _ (e.g. SUMMER10).");
  const kind = z.enum(["percent", "amount"]).parse(formData.get("kind"));
  const currencyRaw = text(formData.get("currency")).toLowerCase();
  const currency = currencyRaw ? currencyRaw : null;
  if (currency && !enabledCurrencies().includes(currency))
    throw new UserFacingError("Choose one of the shop's currencies.");
  const value = text(formData.get("value"));
  let percentBp: number | null = null;
  let amountCents: number | null = null;
  if (kind === "percent") {
    percentBp = parseRatePercent(value);
    if (!percentBp) throw new UserFacingError("Enter a percentage between 0.01 and 100.");
  } else {
    if (!currency) throw new UserFacingError("A fixed amount needs its currency.");
    amountCents = parsePrice(value);
    if (!amountCents) throw new UserFacingError("Enter an amount such as 5 or 5.50.");
  }
  const minRaw = text(formData.get("minSubtotal"));
  const minSubtotalCents = minRaw ? parsePrice(minRaw) : null;
  if (minRaw && !minSubtotalCents) throw new UserFacingError("Enter a minimum such as 40.");
  if (minSubtotalCents && !currency)
    throw new UserFacingError("A minimum order needs the code's currency.");
  const maxRaw = text(formData.get("maxRedemptions"));
  const maxRedemptions = maxRaw
    ? z.coerce.number().int().min(1).max(1_000_000).parse(maxRaw)
    : null;
  const untilRaw = text(formData.get("validUntil"));
  if (untilRaw && !/^\d{4}-\d{2}-\d{2}$/.test(untilRaw))
    throw new UserFacingError("Use a date such as 2026-12-31.");
  // Valid through the whole last day (UTC).
  const expiresAt = untilRaw ? new Date(Date.parse(`${untilRaw}T00:00:00Z`) + 86_400_000) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime()))
    throw new UserFacingError("Use a date such as 2026-12-31.");
  const taken = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, code));
  if (taken.length > 0) throw new UserFacingError("This code already exists.");
  await db.insert(coupons).values({
    code,
    kind,
    percentBp,
    amountCents,
    currency,
    minSubtotalCents,
    maxRedemptions,
    expiresAt,
  });
  revalidatePath("/dashboard/coupons");
}

/** Codes used by orders keep their history: deactivated, never deleted. */
export async function deactivateCoupon(formData: FormData): Promise<void> {
  await requireAdmin();
  await db
    .update(coupons)
    .set({ active: false })
    .where(eq(coupons.id, z.uuid().parse(formData.get("id"))));
  revalidatePath("/dashboard/coupons");
}
