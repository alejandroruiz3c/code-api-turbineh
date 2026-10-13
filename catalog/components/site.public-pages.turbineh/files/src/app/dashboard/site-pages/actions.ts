"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { UserFacingError } from "@/security/errors";
import { requireAdmin } from "@/server/authz";
import { collectionOf } from "@/site-pages/config";
import { safeImageUrl } from "@/site-pages/rules";
import { deleteEntry, saveEntry } from "@/site-pages/service";

/** Staff edit the public pages (site.public-pages.turbineh): create, update, publish and delete entries. */
const schema = z.object({
  collection: z.string().max(60),
  id: z.union([z.uuid(), z.literal("")]).optional(),
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().max(120).optional(),
  summary: z.string().trim().max(300).optional(),
  body: z.string().max(20_000).optional(),
  imageUrl: z.string().trim().max(500).optional(),
  sort: z.coerce.number().int().min(-1000).max(1000).optional(),
});

export async function saveSiteEntry(formData: FormData): Promise<void> {
  await requireAdmin();
  const input = schema.parse(Object.fromEntries(formData));
  const c = collectionOf(input.collection);
  if (!c) throw new UserFacingError("Unknown page.");
  const attributes = Object.fromEntries(
    c.filters.map((f) => [f.key, String(formData.get(`attr_${f.key}`) ?? "")]),
  );
  if (input.imageUrl && !safeImageUrl(input.imageUrl))
    throw new UserFacingError("Image URLs must start with https://");
  await saveEntry(
    c,
    {
      title: input.title,
      slug: input.slug,
      summary: input.summary ?? "",
      body: input.body ?? "",
      imageUrl: input.imageUrl || null,
      attributes,
      published: formData.get("published") === "on",
      sort: input.sort ?? 0,
    },
    input.id || undefined,
  );
  revalidatePath(c.path, "layout");
  redirect(`/dashboard/site-pages/${c.key}`);
}

export async function deleteSiteEntry(formData: FormData): Promise<void> {
  await requireAdmin();
  const c = collectionOf(String(formData.get("collection") ?? ""));
  if (!c) throw new UserFacingError("Unknown page.");
  await deleteEntry(c, z.uuid().parse(formData.get("id")));
  revalidatePath(`/dashboard/site-pages/${c.key}`);
}
