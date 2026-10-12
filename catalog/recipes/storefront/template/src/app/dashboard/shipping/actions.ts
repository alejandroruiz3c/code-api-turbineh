"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { shippingRates, taxRates } from "@/db/schema";
import { env } from "@/env";
import { isCountry } from "@/lib/countries";
import { parseCountries, parsePrice, parseRatePercent } from "@/lib/shop";
import { UserFacingError } from "@/security/errors";
import { requireAdmin } from "@/server/admin";
import { enabledCurrencies } from "@/server/currency";

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

/** Flat-price shipping rate for some countries (empty list = everywhere), optionally free from an amount. */
export async function saveShippingRate(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = z
    .string()
    .min(2)
    .max(80)
    .safeParse(text(formData.get("name")));
  if (!name.success) throw new UserFacingError("Give the shipping option a name.");
  const countries = parseCountries(text(formData.get("countries")));
  if (!countries || countries.some((c) => !isCountry(c)))
    throw new UserFacingError("Use two-letter country codes separated by commas, e.g. ES, PT.");
  const price = text(formData.get("price"));
  // "0" is a valid price here (free shipping); parsePrice only accepts positive amounts.
  const priceCents = /^\s*0+([.,]0{1,2})?\s*$/.test(price) ? 0 : parsePrice(price);
  if (priceCents === null) throw new UserFacingError("Enter a price such as 4.90 (or 0).");
  const freeOver = text(formData.get("freeOver"));
  const freeOverCents = freeOver ? parsePrice(freeOver) : null;
  if (freeOver && !freeOverCents) throw new UserFacingError("Enter an amount such as 50.");
  const currency = text(formData.get("currency")).toLowerCase() || env.SHOP_CURRENCY;
  if (!enabledCurrencies().includes(currency))
    throw new UserFacingError("Choose one of the shop's currencies.");
  await db.insert(shippingRates).values({
    name: name.data,
    countries: countries.join(","),
    priceCents,
    freeOverCents,
    // null = the base currency, so rates keep working if the base currency setting changes.
    currency: currency === env.SHOP_CURRENCY ? null : currency,
  });
  revalidatePath("/dashboard/shipping");
}

export async function removeShippingRate(formData: FormData): Promise<void> {
  await requireAdmin();
  await db
    .update(shippingRates)
    .set({ active: false })
    .where(eq(shippingRates.id, z.uuid().parse(formData.get("id"))));
  revalidatePath("/dashboard/shipping");
}

/** Tax rate for a country ("*" = every other country); saving a country again replaces its rate. */
export async function saveTaxRate(formData: FormData): Promise<void> {
  await requireAdmin();
  const country = text(formData.get("country")).toUpperCase();
  if (country !== "*" && !isCountry(country))
    throw new UserFacingError("Use a two-letter country code (or * for every other country).");
  const label = z
    .string()
    .min(2)
    .max(40)
    .safeParse(text(formData.get("label")));
  if (!label.success) throw new UserFacingError("Name the tax, e.g. VAT.");
  const rateBp = parseRatePercent(text(formData.get("rate")));
  if (rateBp === null) throw new UserFacingError("Enter a percentage between 0 and 100.");
  await db
    .insert(taxRates)
    .values({ country, label: label.data, rateBp })
    .onConflictDoUpdate({ target: taxRates.country, set: { label: label.data, rateBp } });
  revalidatePath("/dashboard/shipping");
}

export async function removeTaxRate(formData: FormData): Promise<void> {
  await requireAdmin();
  await db.delete(taxRates).where(eq(taxRates.id, z.uuid().parse(formData.get("id"))));
  revalidatePath("/dashboard/shipping");
}
