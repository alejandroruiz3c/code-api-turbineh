import { isEmailAddress } from "@turbineh/shared";
import type pg from "pg";

/**
 * Contact email of a workspace (ADR-0074). People who enter with the shared invitation token work in an anonymous
 * `invite:<uuid>` workspace; the access page asks for an email and it is stored here, then used as the contact email of
 * that workspace's plans and builds (and so of its uncovered requests, ADR-0052/0056). Shared workspaces (the
 * invitation token's `api-default` or any guessable name) never get one: several people use them, so an email stored
 * there would reach the wrong person. Only staff read the address (owner report, demand list); the workspace itself
 * only ever gets it back masked.
 */
type Db = Pick<pg.Pool, "query">;

/** Changes of a workspace's email allowed per 24 hours (setting the same address again does not count). */
export const CONTACT_CHANGES_PER_DAY = 10;
/** Times the email of one refused flow can be set after the fact (POST /v1/builds/{id}/notify). */
export const DEMAND_EMAIL_UPDATES = 5;

/**
 * Accounts, API keys and random workspace ids (UUIDs: the browser cookie, `turbineh init`) belong to one person or
 * team; `invite:<guessable name>` workspaces are shared by whoever sends that name with the invitation token.
 */
export const isPrivateOwner = (ownerId: string): boolean =>
  !ownerId.startsWith("invite:") ||
  /^invite:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ownerId);

/** Lower-cased, trimmed address, or null when it is not a usable email address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const e = value.trim().toLowerCase();
  return isEmailAddress(e) ? e : null;
}

/** "a•••@example.com": enough for a person to recognise their own address, nothing more. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

export async function getWorkspaceContact(db: Db, ownerId: string): Promise<string | null> {
  if (!isPrivateOwner(ownerId)) return null;
  const r = await db.query<{ email: string }>(
    "SELECT email FROM workspace_contacts WHERE owner_id = $1",
    [ownerId],
  );
  return r.rows[0]?.email ?? null;
}

export type SetContactResult = "saved" | "unchanged" | "rate_limited" | "shared_workspace";

/**
 * Stores (or changes) the workspace's email, at most `CONTACT_CHANGES_PER_DAY` changes per 24 hours. The workspace's
 * earlier uncovered requests without an email (or with the previous one) and its priority subscription get the new
 * address, so the owner can tell them when their request is covered. No email is sent here.
 */
export async function setWorkspaceContact(
  db: Db,
  ownerId: string,
  rawEmail: string,
): Promise<SetContactResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new Error("invalid email address");
  if (!isPrivateOwner(ownerId)) return "shared_workspace";
  const before = await db.query<{ email: string }>(
    "SELECT email FROM workspace_contacts WHERE owner_id = $1",
    [ownerId],
  );
  const previous = before.rows[0]?.email ?? null;
  if (previous === email) return "unchanged";
  const res = await db.query(
    `INSERT INTO workspace_contacts AS w (owner_id, email) VALUES ($1, $2)
     ON CONFLICT (owner_id) DO UPDATE SET
       email = EXCLUDED.email,
       updated_at = now(),
       changes = CASE WHEN w.window_start < now() - interval '1 day' THEN 1 ELSE w.changes + 1 END,
       window_start = CASE WHEN w.window_start < now() - interval '1 day' THEN now() ELSE w.window_start END
     WHERE w.window_start < now() - interval '1 day' OR w.changes < $3`,
    [ownerId, email, CONTACT_CHANGES_PER_DAY],
  );
  if (res.rowCount === 0) return "rate_limited";
  await db.query(
    `UPDATE use_case_demand SET email = $2
     WHERE owner_id = $1 AND (email IS NULL OR ($3::text IS NOT NULL AND email = $3))`,
    [ownerId, email, previous],
  );
  await db.query(
    `UPDATE priority_notifications SET email = $2
     WHERE owner_id = $1 AND (email IS NULL OR ($3::text IS NOT NULL AND email = $3))`,
    [ownerId, email, previous],
  );
  return "saved";
}

/** Forgets the workspace's email (it stays on demand rows already recorded, which only staff see). */
export async function deleteWorkspaceContact(db: Db, ownerId: string): Promise<boolean> {
  const r = await db.query("DELETE FROM workspace_contacts WHERE owner_id = $1", [ownerId]);
  return (r.rowCount ?? 0) > 0;
}

export interface DemandContactStatus {
  /** The flow was refused (fully or in part) and recorded as demand. */
  demand: boolean;
  /** An email is on file for the notice: the row's own, or the subscription's of a private workspace. */
  emailOnFile: boolean;
  /** The priority-list confirmation was already emailed. */
  confirmed: boolean;
}

export async function demandContactStatus(
  db: Db,
  buildId: string,
  ownerId: string,
): Promise<DemandContactStatus> {
  const r = await db.query<{ email: string | null; confirmed: boolean }>(
    `SELECT CASE WHEN $3 THEN coalesce(d.email, p.email) ELSE d.email END AS email,
            d.confirmation_sent_at IS NOT NULL AS confirmed
     FROM use_case_demand d LEFT JOIN priority_notifications p ON p.owner_id = d.owner_id
     WHERE d.build_id = $1 AND d.owner_id = $2`,
    [buildId, ownerId, isPrivateOwner(ownerId)],
  );
  const row = r.rows[0];
  return {
    demand: Boolean(row),
    emailOnFile: Boolean(row && isEmailAddress(row.email)),
    confirmed: Boolean(row?.confirmed),
  };
}

export type SetDemandEmailResult =
  | { status: "no_demand" }
  | { status: "rate_limited" }
  | { status: "saved"; confirmationPending: boolean };

/**
 * "Notify me when it's covered" on one refused flow: the email goes on the flow's demand row (and on the priority
 * subscription of a private workspace). When the confirmation was not emailed yet, its attempts are reset so
 * `sendDemandEmails(…, { anyAge: true })` sends it once. At most `DEMAND_EMAIL_UPDATES` times per row.
 */
export async function setDemandEmail(
  db: Db,
  buildId: string,
  ownerId: string,
  rawEmail: string,
): Promise<SetDemandEmailResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new Error("invalid email address");
  const res = await db.query<{ confirmation_pending: boolean }>(
    `UPDATE use_case_demand SET
       email = $3,
       email_updates = email_updates + 1,
       confirmation_attempts = CASE WHEN confirmation_sent_at IS NULL THEN 0 ELSE confirmation_attempts END
     WHERE build_id = $1 AND owner_id = $2 AND email_updates < $4
     RETURNING confirmation_sent_at IS NULL AS confirmation_pending`,
    [buildId, ownerId, email, DEMAND_EMAIL_UPDATES],
  );
  if (!res.rows[0]) {
    const exists = await db.query(
      "SELECT 1 FROM use_case_demand WHERE build_id = $1 AND owner_id = $2",
      [buildId, ownerId],
    );
    return { status: exists.rowCount ? "rate_limited" : "no_demand" };
  }
  if (isPrivateOwner(ownerId)) {
    await db.query(
      `INSERT INTO priority_notifications (owner_id, email) VALUES ($1, $2)
       ON CONFLICT (owner_id) DO UPDATE SET email = EXCLUDED.email`,
      [ownerId, email],
    );
  }
  return { status: "saved", confirmationPending: res.rows[0].confirmation_pending };
}
