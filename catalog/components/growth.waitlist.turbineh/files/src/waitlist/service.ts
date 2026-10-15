import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { waitlistSignups } from "@/db/schema";
import { env } from "@/env";
import { sendEmail } from "@/lib/email";
import { waitlistConfig as cfg } from "./config";
import { positions } from "./rules";

/**
 * Waitlist service (component growth.waitlist.turbineh): the only code that adds, confirms, ranks, exports or removes
 * signups. Joining answers the same for new and known emails (no enumeration); the confirmation link is single-purpose
 * and stored hashed; positions and referral boosts are computed by the pure rule in rules.ts.
 */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const appUrl = () => env.BETTER_AUTH_URL.replace(/\/+$/, "");
const code = () => randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8);
export const referralLink = (referralCode: string) => `${appUrl()}/?ref=${referralCode}`;

export type Signup = typeof waitlistSignups.$inferSelect;

/** Adds a signup (pending until confirmed when double opt-in is on) and emails the confirmation/status link. */
export async function join(input: {
  name: string;
  email: string;
  ref?: string | null;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const token = randomBytes(24).toString("base64url");
  let referredBy: string | null = null;
  if (cfg.referral.enabled && input.ref && /^[\w-]{4,16}$/.test(input.ref)) {
    const [r] = await db
      .select({ id: waitlistSignups.id, email: waitlistSignups.email })
      .from(waitlistSignups)
      .where(eq(waitlistSignups.referralCode, input.ref))
      .limit(1);
    if (r && r.email !== email) referredBy = r.id;
  }
  const now = new Date();
  const inserted = await db
    .insert(waitlistSignups)
    .values({
      name: input.name.trim().slice(0, 120),
      email,
      tokenHash: hashToken(token),
      referralCode: code(),
      referredBy,
      status: cfg.doubleOptIn ? "pending" : "confirmed",
      confirmedAt: cfg.doubleOptIn ? null : now,
    })
    .onConflictDoNothing({ target: waitlistSignups.email })
    .returning({ id: waitlistSignups.id });
  // Known emails get nothing new: the visitor sees the same answer either way.
  if (inserted.length === 0) return;
  const link = `${appUrl()}/waitlist/confirm/${token}`;
  await sendEmail({
    to: email,
    subject: cfg.doubleOptIn ? "Confirm your place on the waitlist" : "You're on the waitlist",
    text: cfg.doubleOptIn
      ? `Hi ${input.name.trim()}, confirm your email to keep your place: ${link}\nIf you did not sign up, ignore this email.`
      : `Hi ${input.name.trim()}, you're on the waitlist. Your position and referral link: ${link}`,
    link,
  });
}

async function byToken(token: string): Promise<Signup | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const [row] = await db
    .select()
    .from(waitlistSignups)
    .where(eq(waitlistSignups.tokenHash, hashToken(token)))
    .limit(1);
  return row ?? null;
}

/** Confirms the signup of this link (idempotent); null when the link is not valid. */
export async function confirm(token: string): Promise<Signup | null> {
  const row = await byToken(token);
  if (!row) return null;
  if (row.status === "confirmed") return row;
  const [updated] = await db
    .update(waitlistSignups)
    .set({ status: "confirmed", confirmedAt: new Date() })
    .where(and(eq(waitlistSignups.id, row.id), eq(waitlistSignups.status, "pending")))
    .returning();
  return updated ?? (await byToken(token));
}

/** Every confirmed signup with its confirmed referrals and position. */
export async function ranking() {
  const confirmed = await db
    .select()
    .from(waitlistSignups)
    .where(isNotNull(waitlistSignups.confirmedAt));
  const refs = await db
    .select({ id: waitlistSignups.referredBy, n: count() })
    .from(waitlistSignups)
    .where(and(isNotNull(waitlistSignups.referredBy), isNotNull(waitlistSignups.confirmedAt)))
    .groupBy(waitlistSignups.referredBy);
  const referrals = new Map(refs.map((r) => [r.id ?? "", Number(r.n)]));
  const pos = positions(
    confirmed.map((c) => ({
      id: c.id,
      confirmedAt: c.confirmedAt ?? c.createdAt,
      referrals: cfg.referral.enabled ? (referrals.get(c.id) ?? 0) : 0,
    })),
    cfg.referral.boost,
  );
  return { pos, referrals };
}

/** What the person behind a confirmation/status link sees. */
export async function status(token: string) {
  const row = await byToken(token);
  if (!row) return null;
  const { pos, referrals } = await ranking();
  const confirmedTotal = pos.size;
  return {
    name: row.name,
    confirmed: row.status === "confirmed",
    position: row.status === "confirmed" ? (pos.get(row.id) ?? null) : null,
    total: confirmedTotal,
    referrals: referrals.get(row.id) ?? 0,
    referralLink: cfg.referral.enabled ? referralLink(row.referralCode) : null,
  };
}

/** Staff view: every signup, best position first, then pending ones. */
export async function listSignups(limit = 1000) {
  const rows = await db
    .select()
    .from(waitlistSignups)
    .orderBy(desc(waitlistSignups.createdAt))
    .limit(limit);
  const { pos, referrals } = await ranking();
  return rows
    .map((r) => ({ ...r, position: pos.get(r.id) ?? null, referrals: referrals.get(r.id) ?? 0 }))
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
}

export async function removeSignups(ids: string[]): Promise<void> {
  if (!ids.length) return;
  // Referrals of removed people no longer count.
  await db
    .update(waitlistSignups)
    .set({ referredBy: null })
    .where(inArray(waitlistSignups.referredBy, ids));
  await db.delete(waitlistSignups).where(inArray(waitlistSignups.id, ids));
}

export async function counts() {
  const [r] = await db
    .select({
      total: count(),
      confirmed: sql<number>`count(*) filter (where ${waitlistSignups.status} = 'confirmed')`,
    })
    .from(waitlistSignups);
  return { total: Number(r?.total ?? 0), confirmed: Number(r?.confirmed ?? 0) };
}
