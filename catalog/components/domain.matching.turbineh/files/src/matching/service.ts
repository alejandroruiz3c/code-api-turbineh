import { and, asc, desc, eq, ilike, inArray, lte, or, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { matchingFeedback, matchingProfiles, matchingRecords } from "@/db/schema";
import { audit } from "@/lib/audit";
import { UserFacingError } from "@/security/errors";
import type { Role } from "@/server/authz";
import { matchingConfig, type Feedback } from "./config";
import { mayCreateRecords, mayEditProfile, mayEditRecords, mayGiveFeedback } from "./policy";
import { feedbackInput, likePattern, profileInput, recordInput, type RecordFilters } from "./rules";
import { matchRecords, todayIso, type Match, type MatchingProfile } from "./score";

/**
 * Matching service (component domain.matching.turbineh): the only code that reads or writes profiles, records and
 * feedback. Every function takes the caller (from requireMember() or the API's session check) and filters by the
 * caller's active organization, so one organization never reads or changes another's data.
 */
export interface Actor {
  userId: string;
  email?: string;
  organizationId: string;
  role: Role;
}

export type MatchRecord = typeof matchingRecords.$inferSelect;

const EMPTY: MatchingProfile = { sectors: [], activities: [], regions: [], keywords: [] };

export async function getProfile(
  actor: Actor,
): Promise<MatchingProfile & { updatedAt: Date | null }> {
  const [row] = await db
    .select()
    .from(matchingProfiles)
    .where(eq(matchingProfiles.organizationId, actor.organizationId));
  return row
    ? {
        sectors: row.sectors,
        activities: row.activities,
        regions: row.regions,
        keywords: row.keywords,
        updatedAt: row.updatedAt,
      }
    : { ...EMPTY, updatedAt: null };
}

export async function saveProfile(actor: Actor, raw: unknown): Promise<MatchingProfile> {
  if (!mayEditProfile(actor.role))
    throw new UserFacingError(
      "Only members who manage the organization's settings can change its profile.",
    );
  const p = profileInput.parse(raw);
  const before = await getProfile(actor);
  await db.transaction(async (tx) => {
    await tx
      .insert(matchingProfiles)
      .values({ organizationId: actor.organizationId, ...p, updatedBy: actor.userId })
      .onConflictDoUpdate({
        target: matchingProfiles.organizationId,
        set: { ...p, updatedBy: actor.userId, updatedAt: new Date() },
      });
    await audit(
      {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        actorEmail: actor.email ?? null,
        action: "matching_profile.updated",
        subjectType: "MatchingProfile",
        subjectId: actor.organizationId,
        before: { ...before, updatedAt: undefined },
        after: p,
      },
      tx,
    );
  });
  return p;
}

export async function listRecords(
  actor: Actor,
  filters: RecordFilters,
  page: { limit: number; offset: number },
): Promise<MatchRecord[]> {
  const where: SQL[] = [eq(matchingRecords.organizationId, actor.organizationId)];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    const text = or(
      ilike(matchingRecords.title, pattern),
      ilike(matchingRecords.description, pattern),
    );
    if (text) where.push(text);
  }
  if (filters.sector) where.push(ilike(matchingRecords.sector, likePattern(filters.sector)));
  if (filters.region) where.push(ilike(matchingRecords.region, likePattern(filters.region)));
  if (filters.status) where.push(eq(matchingRecords.status, filters.status));
  if (filters.before) where.push(lte(matchingRecords.deadline, filters.before));
  return db
    .select()
    .from(matchingRecords)
    .where(and(...where))
    .orderBy(desc(matchingRecords.createdAt), asc(matchingRecords.id))
    .limit(page.limit)
    .offset(page.offset);
}

/** One record of the caller's organization, or null (another organization's id is "not found", never "forbidden"). */
export async function getRecord(actor: Actor, id: string): Promise<MatchRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select()
    .from(matchingRecords)
    .where(
      and(eq(matchingRecords.id, id), eq(matchingRecords.organizationId, actor.organizationId)),
    );
  return row ?? null;
}

export async function createRecord(actor: Actor, raw: unknown): Promise<MatchRecord> {
  if (!mayCreateRecords(actor.role))
    throw new UserFacingError(`You cannot add ${matchingConfig.entity.plural}.`);
  const input = recordInput.parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(matchingRecords)
      .values({ ...input, organizationId: actor.organizationId, createdBy: actor.userId })
      .returning();
    if (!row) throw new Error("insert returned nothing");
    await audit(
      {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        actorEmail: actor.email ?? null,
        action: "matching_record.created",
        subjectType: "MatchingRecord",
        subjectId: row.id,
        after: input,
      },
      tx,
    );
    return row;
  });
}

export async function updateRecord(actor: Actor, id: string, raw: unknown): Promise<MatchRecord> {
  if (!mayEditRecords(actor.role))
    throw new UserFacingError(`You cannot edit ${matchingConfig.entity.plural}.`);
  const before = await getRecord(actor, id);
  if (!before) throw new UserFacingError("Not found.");
  const input = recordInput.parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(matchingRecords)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(eq(matchingRecords.id, id), eq(matchingRecords.organizationId, actor.organizationId)),
      )
      .returning();
    if (!row) throw new UserFacingError("Not found.");
    await audit(
      {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        actorEmail: actor.email ?? null,
        action: "matching_record.updated",
        subjectType: "MatchingRecord",
        subjectId: id,
        before: { ...before },
        after: input,
      },
      tx,
    );
    return row;
  });
}

/** The organization's feedback on records (record id → verdict). */
export async function feedbackOf(
  actor: Actor,
  ids?: readonly string[],
): Promise<Map<string, Feedback>> {
  const where = [eq(matchingFeedback.organizationId, actor.organizationId)];
  if (ids) {
    if (ids.length === 0) return new Map();
    where.push(inArray(matchingFeedback.recordId, [...ids]));
  }
  const rows = await db
    .select({ recordId: matchingFeedback.recordId, verdict: matchingFeedback.verdict })
    .from(matchingFeedback)
    .where(and(...where));
  return new Map(rows.map((r) => [r.recordId, r.verdict as Feedback]));
}

export async function setFeedback(actor: Actor, raw: unknown): Promise<void> {
  if (!mayGiveFeedback(actor.role)) throw new UserFacingError("You cannot give feedback.");
  const { recordId, verdict } = feedbackInput.parse(raw);
  if (!(await getRecord(actor, recordId))) throw new UserFacingError("Not found.");
  await db
    .insert(matchingFeedback)
    .values({ organizationId: actor.organizationId, recordId, verdict, userId: actor.userId })
    .onConflictDoUpdate({
      target: [matchingFeedback.organizationId, matchingFeedback.recordId],
      set: { verdict, userId: actor.userId, updatedAt: new Date() },
    });
}

/** Upper bound of records scored per request (the whole open set of a typical organization). */
export const MATCH_SCAN_LIMIT = 2000;

/**
 * The organization's matches, best first, each with why it matches. Live records only (open, deadline not passed);
 * records the organization marked "not relevant" are left out.
 */
export async function matchesFor(actor: Actor, now = new Date()): Promise<Match<MatchRecord>[]> {
  const profile = await getProfile(actor);
  const today = todayIso(now);
  const rows = await db
    .select()
    .from(matchingRecords)
    .where(
      and(
        eq(matchingRecords.organizationId, actor.organizationId),
        eq(matchingRecords.status, "open"),
      ),
    )
    .orderBy(asc(matchingRecords.id))
    .limit(MATCH_SCAN_LIMIT);
  const feedback = await feedbackOf(actor);
  const hidden = new Set([...feedback].filter(([, v]) => v === "not_relevant").map(([k]) => k));
  return matchRecords(profile, rows, {
    weights: matchingConfig.weights,
    minScore: matchingConfig.minScore,
    today,
    hidden,
  });
}
