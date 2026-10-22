"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import * as blog from "@/blog/posts";
import { UserFacingError } from "@/security/errors";
import { requireAdmin } from "@/server/authz";

/** Blog editor actions (component content.blog.turbineh): staff only (ADMIN_EMAILS, verified), deny by default. */

export type EditorState = { error: string | null };

const postSchema = z.object({
  id: z.uuid().optional().or(z.literal("")),
  title: z.string().max(160).optional(),
  slug: z.string().max(120).optional(),
  excerpt: z.string().max(300).optional(),
  authorId: z.uuid().optional().or(z.literal("")),
  tags: z.string().max(500).optional(),
  body: z.string().max(110_000),
  intent: z.enum(["draft", "publish"]),
});

function refresh() {
  revalidatePath("/blog", "layout");
  revalidatePath("/dashboard/blog");
}

/** Saves a post from the editor: "Save draft" keeps it private, "Publish" makes it public. */
export async function savePostAction(_prev: EditorState, formData: FormData): Promise<EditorState> {
  await requireAdmin();
  const parsed = postSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the form: the text is required." };
  const d = parsed.data;
  try {
    await blog.savePost({
      id: d.id || null,
      title: d.title ?? "",
      slug: d.slug ?? "",
      excerpt: d.excerpt ?? "",
      authorId: d.authorId || null,
      tags: d.tags ?? "",
      source: d.body,
      intent: d.intent,
    });
  } catch (err) {
    if (err instanceof UserFacingError) return { error: err.message };
    throw err;
  }
  refresh();
  redirect("/dashboard/blog");
}

const idSchema = z.object({ id: z.uuid() });

export async function publishPost(formData: FormData): Promise<void> {
  await requireAdmin();
  await blog.setStatus(idSchema.parse(Object.fromEntries(formData)).id, "published");
  refresh();
}

export async function unpublishPost(formData: FormData): Promise<void> {
  await requireAdmin();
  await blog.setStatus(idSchema.parse(Object.fromEntries(formData)).id, "draft");
  refresh();
}

export async function deletePostAction(formData: FormData): Promise<void> {
  await requireAdmin();
  await blog.deletePost(idSchema.parse(Object.fromEntries(formData)).id);
  refresh();
}

const authorSchema = z.object({
  id: z.uuid().optional().or(z.literal("")),
  name: z.string().max(120),
  bio: z.string().max(1000).optional(),
});

export async function saveAuthorAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const d = authorSchema.parse(Object.fromEntries(formData));
  await blog.saveAuthor({ id: d.id || null, name: d.name, bio: d.bio ?? "" });
  refresh();
  revalidatePath("/dashboard/blog/authors");
}

export async function deleteAuthorAction(formData: FormData): Promise<void> {
  await requireAdmin();
  await blog.deleteAuthor(idSchema.parse(Object.fromEntries(formData)).id);
  refresh();
  revalidatePath("/dashboard/blog/authors");
}
