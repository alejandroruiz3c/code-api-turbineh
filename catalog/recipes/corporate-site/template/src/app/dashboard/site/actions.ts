"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { siteSettings } from "@/db/schema";
import { UserFacingError } from "@/security/errors";
import { requireAdmin } from "@/server/admin";
import { siteSchema } from "@/server/site";

/** "Title | text" per line → items. */
const items = (raw: FormDataEntryValue | null) =>
  String(raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [title = "", ...rest] = l.split("|");
      return { title: title.trim(), text: rest.join("|").trim() };
    });

export async function saveSite(formData: FormData): Promise<void> {
  await requireAdmin();
  const faq = items(formData.get("faq")).map((i) => ({ q: i.title, a: i.text }));
  const parsed = siteSchema.safeParse({
    tagline: formData.get("tagline"),
    hero_subtitle: formData.get("hero_subtitle"),
    about: formData.get("about"),
    cta: formData.get("cta"),
    services: items(formData.get("services")),
    features: items(formData.get("features")),
    faq,
  });
  if (!parsed.success)
    throw new UserFacingError(`Check the texts: ${parsed.error.issues[0]?.path.join(".") ?? ""}`);
  await db
    .insert(siteSettings)
    .values({ id: 1, content: parsed.data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: siteSettings.id,
      set: { content: parsed.data, updatedAt: new Date() },
    });
  revalidatePath("/", "layout");
  redirect("/dashboard/site?saved=1");
}
