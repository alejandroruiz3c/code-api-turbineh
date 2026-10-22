import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { recommendationItems, recommendationProfiles } from "@/db/schema";
import { recommendationConfig as cfg } from "./config";
import { EMPTY_PREFERENCES, rankItems, type CatalogItem, type Preferences } from "./search";

/**
 * Database access of the recommendations (component ai.recommendations.turbineh): Drizzle only. Reads for people
 * (assistant, compare page) return verified, active records only.
 */
type Row = typeof recommendationItems.$inferSelect;

export const toItem = (r: Row): CatalogItem => ({
  reference: r.reference,
  title: r.title,
  description: r.description,
  price: Number(r.price),
  currency: r.currency,
  location: r.location,
  attributes: r.attributes ?? {},
  verified: r.verified,
  active: r.active,
});

const published = and(eq(recommendationItems.verified, true), eq(recommendationItems.active, true));

/** Every verified, active record (the only ones a person is ever shown). */
export async function publishedItems(): Promise<CatalogItem[]> {
  const rows = await db
    .select()
    .from(recommendationItems)
    .where(published)
    .orderBy(asc(recommendationItems.price), asc(recommendationItems.reference));
  return rows.map(toItem);
}

/** Verified, active records by reference, in the order asked; unknown references are listed apart. */
export async function publishedByReference(
  references: readonly string[],
): Promise<{ items: CatalogItem[]; unknown: string[] }> {
  const refs = [...new Set(references.map((r) => r.trim().toUpperCase()))];
  const rows = refs.length
    ? await db
        .select()
        .from(recommendationItems)
        .where(and(published, inArray(recommendationItems.reference, refs)))
    : [];
  const byRef = new Map(rows.map((r) => [r.reference, toItem(r)]));
  return {
    items: refs.flatMap((r) => {
      const i = byRef.get(r);
      return i ? [i] : [];
    }),
    unknown: refs.filter((r) => !byRef.has(r)),
  };
}

/** The preferences one conversation recorded (empty when none yet). */
export async function preferencesOf(conversation: string): Promise<Preferences> {
  const [p] = await db
    .select()
    .from(recommendationProfiles)
    .where(eq(recommendationProfiles.conversation, conversation));
  if (!p) return { ...EMPTY_PREFERENCES, needs: {} };
  return {
    budgetMax: p.budgetMax === null ? null : Number(p.budgetMax),
    location: p.location,
    needs: p.needs ?? {},
  };
}

/** Stores the conversation's preferences (one row per conversation, updated as the person adds details). */
export async function savePreferences(conversation: string, p: Preferences): Promise<void> {
  const values = {
    conversation: conversation.slice(0, 120),
    budgetMax: p.budgetMax === null ? null : String(p.budgetMax),
    location: p.location?.slice(0, 120) ?? null,
    needs: p.needs,
    updatedAt: new Date(),
  };
  await db
    .insert(recommendationProfiles)
    .values(values)
    .onConflictDoUpdate({ target: recommendationProfiles.conversation, set: values });
}

/** Recommendations for preferences, from the database only (see rankItems for the rules). */
export async function recommend(p: Preferences, limit = cfg.maxResults): Promise<CatalogItem[]> {
  return rankItems(await publishedItems(), p, cfg, limit);
}

/** Staff: every record (verified or not), newest first. */
export async function allItems(): Promise<Row[]> {
  return db.select().from(recommendationItems).orderBy(desc(recommendationItems.updatedAt));
}

/** Staff: the preferences people stated, newest first. */
export async function recentProfiles(limit = 100) {
  return db
    .select()
    .from(recommendationProfiles)
    .orderBy(desc(recommendationProfiles.updatedAt))
    .limit(limit);
}
