"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { IMAGE_MAX_BYTES, imageType, parsePrice } from "@/lib/shop";
import { slugify } from "@/lib/text";
import { UserFacingError } from "@/security/errors";
import { requireAdmin } from "@/server/admin";

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
