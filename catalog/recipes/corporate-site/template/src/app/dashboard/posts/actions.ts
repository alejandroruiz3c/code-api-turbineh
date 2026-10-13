"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { posts } from "@/db/schema";
import { slugify } from "@/lib/text";
import { UserFacingError } from "@/security/errors";
import { requireAdmin } from "@/server/admin";

const postSchema = z.object({
  title: z.string().trim().min(3).max(160),
  excerpt: z.string().trim().min(10).max(300),
  body: z.string().trim().min(10).max(50_000),
  published: z.literal("on").optional(),
});

/** Blog post actions: save (create, edit, publish) and delete (staff only). */
export async function savePost(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get("id") ? z.uuid().parse(formData.get("id")) : null;
  const parsed = postSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    throw new UserFacingError("Title (3+), summary (10+) and text (10+) are required.");
  const { title, excerpt, body } = parsed.data;
  const published = parsed.data.published === "on";
  if (id) {
    const [current] = await db
      .select({ publishedAt: posts.publishedAt })
      .from(posts)
      .where(eq(posts.id, id));
    if (!current) throw new UserFacingError("Post not found.");
    await db
      .update(posts)
      .set({
        title,
        excerpt,
        body,
        published,
        publishedAt: published ? (current.publishedAt ?? new Date()) : current.publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));
  } else {
    let slug = slugify(title);
    const [taken] = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug));
    if (taken) slug = `${slug}-${Date.now().toString(36)}`;
    await db.insert(posts).values({
      slug,
      title,
      excerpt,
      body,
      published,
      publishedAt: published ? new Date() : null,
    });
  }
  revalidatePath("/blog");
  revalidatePath("/dashboard/posts");
  redirect("/dashboard/posts");
}

export async function deletePost(formData: FormData): Promise<void> {
  await requireAdmin();
  await db.delete(posts).where(eq(posts.id, z.uuid().parse(formData.get("id"))));
  revalidatePath("/blog");
  revalidatePath("/dashboard/posts");
}
