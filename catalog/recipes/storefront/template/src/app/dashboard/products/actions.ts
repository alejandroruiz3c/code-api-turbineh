"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { productPrices, products, productVariants } from "@/db/schema";
import { IMAGE_MAX_BYTES, imageType, parsePrice } from "@/lib/shop";
import { slugify } from "@/lib/text";
import { UserFacingError } from "@/security/errors";
import { requireAdmin } from "@/server/admin";
import { enabledCurrencies } from "@/server/currency";

const base = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(5).max(5000),
  price: z.string().trim(),
  stock: z.string().trim().optional(),
  active: z.literal("on").optional(),
});

async function readImage(formData: FormData): Promise<{ image: Buffer; imageMime: string } | null> {
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > IMAGE_MAX_BYTES) throw new UserFacingError("Images can be up to 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = imageType(bytes);
  if (!mime) throw new UserFacingError("Use a PNG, JPEG or WebP image.");
  return { image: Buffer.from(bytes), imageMime: mime };
}

export async function saveProduct(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get("id") ? z.uuid().parse(formData.get("id")) : null;
  const parsed = base.safeParse(
    Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")),
  );
  if (!parsed.success) throw new UserFacingError("Name, description and price are required.");
  const priceCents = parsePrice(parsed.data.price);
  if (!priceCents) throw new UserFacingError("Enter a price such as 19.90.");
  const stock = parsed.data.stock
    ? z.coerce.number().int().min(0).max(1_000_000).parse(parsed.data.stock)
    : null;
  const image = await readImage(formData);
  const values = {
    name: parsed.data.name,
    description: parsed.data.description,
    priceCents,
    stock,
    active: parsed.data.active === "on",
    updatedAt: new Date(),
    ...(image ?? {}),
  };
  if (id) {
    await db.update(products).set(values).where(eq(products.id, id));
  } else {
    let slug = slugify(parsed.data.name);
    if (
      (await db.select({ id: products.id }).from(products).where(eq(products.slug, slug))).length >
      0
    )
      slug = `${slug}-${Date.now().toString(36)}`;
    await db.insert(products).values({ ...values, slug });
  }
  revalidatePath("/shop");
  revalidatePath("/dashboard/products");
  redirect("/dashboard/products");
}

const variantInput = z.object({
  productId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  sku: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9._-]*$/),
  price: z.string().trim().max(12),
  stock: z.string().trim().max(9),
});

/** Adds a variant (size, colour…). Empty price = product price; empty stock = unlimited. */
export async function saveVariant(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = variantInput.safeParse({
    productId: formData.get("productId"),
    name: formData.get("name"),
    sku: formData.get("sku") ?? "",
    price: formData.get("price") ?? "",
    stock: formData.get("stock") ?? "",
  });
  if (!parsed.success)
    throw new UserFacingError("Give the option a name; SKU uses letters, digits, . _ -");
  const priceCents = parsed.data.price ? parsePrice(parsed.data.price) : null;
  if (parsed.data.price && !priceCents) throw new UserFacingError("Enter a price such as 19.90.");
  const stock = parsed.data.stock
    ? z.coerce.number().int().min(0).max(1_000_000).parse(parsed.data.stock)
    : null;
  const sku = parsed.data.sku || null;
  const taken = sku
    ? await db
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.sku, sku))
    : [];
  if (taken.length > 0) throw new UserFacingError("Another option already uses this SKU.");
  await db.insert(productVariants).values({
    productId: parsed.data.productId,
    name: parsed.data.name,
    sku,
    priceCents,
    stock,
  });
  revalidatePath(`/dashboard/products`);
  redirect(`/dashboard/products?edit=${parsed.data.productId}`);
}

/**
 * Prices of a product and its options in the extra currencies (fields "price:<variantId|product>:<currency>").
 * Empty removes the price (not sold in that currency). Options must belong to the product; currencies must be
 * the shop's own extra ones.
 */
export async function saveLocalPrices(formData: FormData): Promise<void> {
  await requireAdmin();
  const productId = z.uuid().parse(formData.get("productId"));
  const extras = new Set(enabledCurrencies().slice(1));
  const own = new Set(
    (
      await db
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.productId, productId))
    ).map((v) => v.id),
  );
  const changes: { variantId: string | null; currency: string; priceCents: number | null }[] = [];
  for (const [key, value] of formData.entries()) {
    const m = /^price:(product|[0-9a-f-]{36}):([a-z]{3})$/.exec(key);
    if (!m || typeof value !== "string") continue;
    const [, target = "", currency = ""] = m;
    if (!extras.has(currency)) continue;
    const variantId = target === "product" ? null : target;
    if (variantId && !own.has(variantId)) throw new UserFacingError("Unknown option.");
    const raw = value.trim();
    const priceCents = raw ? parsePrice(raw) : null;
    if (raw && !priceCents)
      throw new UserFacingError(`Enter prices such as 19.90 (${currency.toUpperCase()}).`);
    changes.push({ variantId, currency, priceCents });
  }
  await db.transaction(async (tx) => {
    for (const c of changes) {
      const same = and(
        eq(productPrices.productId, productId),
        c.variantId ? eq(productPrices.variantId, c.variantId) : isNull(productPrices.variantId),
        eq(productPrices.currency, c.currency),
      );
      if (c.priceCents === null) {
        await tx.delete(productPrices).where(same);
        continue;
      }
      await tx
        .insert(productPrices)
        .values({
          productId,
          variantId: c.variantId,
          currency: c.currency,
          priceCents: c.priceCents,
        })
        .onConflictDoUpdate({
          target: [productPrices.productId, productPrices.variantId, productPrices.currency],
          set: { priceCents: c.priceCents },
        });
    }
  });
  revalidatePath("/shop");
  revalidatePath("/dashboard/products");
  redirect(`/dashboard/products?edit=${productId}`);
}

/** Sets a variant's stock (restock or correction). */
export async function setVariantStock(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.uuid().parse(formData.get("id"));
  const raw = z
    .string()
    .trim()
    .max(9)
    .parse(formData.get("stock") ?? "");
  const stock = raw ? z.coerce.number().int().min(0).max(1_000_000).parse(raw) : null;
  await db.update(productVariants).set({ stock }).where(eq(productVariants.id, id));
  revalidatePath("/dashboard/products");
}

/** Variants with orders keep their history: hidden, never deleted. */
export async function hideVariant(formData: FormData): Promise<void> {
  await requireAdmin();
  await db
    .update(productVariants)
    .set({ active: false })
    .where(eq(productVariants.id, z.uuid().parse(formData.get("id"))));
  revalidatePath("/dashboard/products");
}

export async function deleteProduct(formData: FormData): Promise<void> {
  await requireAdmin();
  // Products with orders keep their history: deactivate instead of deleting.
  await db
    .update(products)
    .set({ active: false })
    .where(eq(products.id, z.uuid().parse(formData.get("id"))));
  revalidatePath("/shop");
  revalidatePath("/dashboard/products");
}
