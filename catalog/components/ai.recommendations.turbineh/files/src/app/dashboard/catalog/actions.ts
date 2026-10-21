"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { recommendationItems } from "@/db/schema";
import { recommendationConfig as cfg } from "@/recommendations/config";
import { attributesSchema, referenceSchema } from "@/recommendations/search";
import { requireAdmin } from "@/server/authz";

/** Staff actions on the catalogue (component ai.recommendations.turbineh): only emails on ADMIN_EMAILS. */

export type ItemState = { error: string | null; done: string | null };

const itemSchema = z.object({
  id: z.uuid().optional(),
  reference: referenceSchema,
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).default(""),
  price: z.coerce.number().positive().max(1_000_000_000),
  location: z.string().trim().min(2).max(120),
  verified: z.literal("on").optional(),
  active: z.literal("on").optional(),
});

/** Unique constraint (SQLSTATE 23505), on the error or the cause Drizzle wraps. */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 3; depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Empty form inputs are "not stated" (null), never 0. */
function attributesFrom(formData: FormData): Record<string, string | null> {
  return Object.fromEntries(
    cfg.fields.map((f) => {
      const v = formData.get(`attr_${f.key}`);
      return [f.key, typeof v === "string" && v.trim() !== "" ? v.trim() : null];
    }),
  );
}

/** Creates or updates a record; marking it verified records who checked it and when. */
export async function saveItem(_prev: ItemState, formData: FormData): Promise<ItemState> {
  const admin = await requireAdmin();
  const raw = Object.fromEntries(
    [...formData.entries()].filter(([k, v]) => !k.startsWith("attr_") && !(k === "id" && v === "")),
  );
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success)
    return { error: "Check the reference (e.g. R-101), title, price and location.", done: null };
  const attrs = attributesSchema(cfg).safeParse(attributesFrom(formData));
  if (!attrs.success)
    return {
      error: `Check the values: ${attrs.error.issues.map((i) => i.path.join(".")).join(", ")}.`,
      done: null,
    };
  const d = parsed.data;
  const verified = d.verified === "on";
  const values = {
    reference: d.reference,
    title: d.title,
    description: d.description,
    price: String(d.price),
    currency: cfg.currency,
    location: d.location,
    attributes: attrs.data as Record<string, string | number | null>,
    verified,
    verifiedBy: verified ? admin.email : null,
    verifiedAt: verified ? new Date() : null,
    active: d.id ? d.active === "on" : true,
    updatedAt: new Date(),
  };
  try {
    if (d.id)
      await db.update(recommendationItems).set(values).where(eq(recommendationItems.id, d.id));
    else await db.insert(recommendationItems).values(values);
  } catch (err) {
    if (isUniqueViolation(err))
      return { error: `Reference ${d.reference} is already used.`, done: null };
    throw err;
  }
  revalidatePath("/dashboard/catalog", "layout");
  return { error: null, done: `Saved ${d.reference}${verified ? " (verified)" : ""}.` };
}

/** Marks a record verified (or not): only verified records are recommended. */
export async function setVerified(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.uuid().parse(formData.get("id"));
  const verified = formData.get("verified") === "true";
  await db
    .update(recommendationItems)
    .set({
      verified,
      verifiedBy: verified ? admin.email : null,
      verifiedAt: verified ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(recommendationItems.id, id));
  revalidatePath("/dashboard/catalog", "layout");
}
