import { createHash } from "node:crypto";
import type pg from "pg";
import { insertAiAppToken } from "./ai-gateway.js";

/**
 * Intelligence Orchestration trials (ADR-0059). A developer signs up on the landing page; the landing server calls
 * POST /v1/ai/trial-signups, which provisions a TurbineH account that is not tied to any build and an orchestration
 * app token for it (ai_apps row with build_id NULL). The account is capped by the trial spend (ADR-0053) like any
 * other. A repeat signup with the same email reuses the account (same spend) and rotates its token.
 */

/** Stable account id of a trial email (lowercased): `trial:` + the first 24 hex chars of its SHA-256. */
export function trialOwnerId(email: string): string {
  return `trial:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24)}`;
}

export interface TrialSignupInput {
  /** Lowercased email. */
  email: string;
  name: string;
  company: string | null;
  useCase: string | null;
  /** HMAC of the person's IP (never the IP itself), or null when unknown. */
  ipHash: string | null;
  dailyTokenQuota: number;
  requestsPerMinute: number;
}

export interface TrialSignupResult {
  ownerId: string;
  token: string;
  prefix: string;
  /** True when the email had signed up before (same account; the previous token was revoked). */
  existing: boolean;
}

/** Signups in the last 24 hours: of this account, of this IP hash, and in total. */
export async function recentTrialSignups(
  db: pg.Pool,
  input: { ownerId: string; ipHash: string | null },
): Promise<{ byOwner: number; byIp: number; total: number }> {
  const res = await db.query<{ by_owner: string; by_ip: string; total: string }>(
    `SELECT count(*) FILTER (WHERE owner_id = $1) AS by_owner,
            count(*) FILTER (WHERE $2::text IS NOT NULL AND ip_hash = $2) AS by_ip,
            count(*) AS total
     FROM orchestration_trial_signups WHERE created_at > now() - interval '1 day'`,
    [input.ownerId, input.ipHash],
  );
  const r = res.rows[0];
  return {
    byOwner: Number(r?.by_owner ?? 0),
    byIp: Number(r?.by_ip ?? 0),
    total: Number(r?.total ?? 0),
  };
}

/**
 * Creates or updates the trial account of an email and issues a new build-less orchestration token, revoking the
 * account's previous build-less tokens (rotation). One transaction. Returns the plaintext token once.
 */
export async function provisionOrchestrationTrial(
  db: pg.Pool,
  input: TrialSignupInput,
): Promise<TrialSignupResult> {
  const ownerId = trialOwnerId(input.email);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const trial = await client.query<{ signups: number }>(
      `INSERT INTO orchestration_trials (owner_id, email, name, company, use_case)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (owner_id) DO UPDATE SET
         name = EXCLUDED.name,
         company = coalesce(EXCLUDED.company, orchestration_trials.company),
         use_case = coalesce(EXCLUDED.use_case, orchestration_trials.use_case),
         signups = orchestration_trials.signups + 1,
         last_signup_at = now()
       RETURNING signups`,
      [ownerId, input.email, input.name, input.company, input.useCase],
    );
    await client.query(
      "INSERT INTO orchestration_trial_signups (owner_id, ip_hash) VALUES ($1, $2)",
      [ownerId, input.ipHash],
    );
    await client.query(
      "UPDATE ai_apps SET revoked_at = now() WHERE owner_id = $1 AND build_id IS NULL AND revoked_at IS NULL",
      [ownerId],
    );
    const created = await insertAiAppToken(client, {
      ownerId,
      buildId: null,
      name: `Orchestration trial · ${input.name}`,
      dailyTokenQuota: input.dailyTokenQuota,
      requestsPerMinute: input.requestsPerMinute,
    });
    await client.query("COMMIT");
    return {
      ownerId,
      token: created.token,
      prefix: created.prefix,
      existing: (trial.rows[0]?.signups ?? 1) > 1,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface TrialRow {
  owner_id: string;
  email: string;
  name: string;
  company: string | null;
  use_case: string | null;
  signups: number;
  created_at: string;
  last_signup_at: string;
  spent_usd: number;
  /** Display prefix of the active token, or null when none is active. */
  active_prefix: string | null;
}

/** Ops listing: trial accounts, newest first, with their spend and active token prefix. */
export async function listOrchestrationTrials(db: pg.Pool, limit = 100): Promise<TrialRow[]> {
  const res = await db.query<Omit<TrialRow, "spent_usd"> & { spent_usd: string | null }>(
    `SELECT t.owner_id, t.email, t.name, t.company, t.use_case, t.signups, t.created_at, t.last_signup_at,
            s.spent_usd,
            (SELECT a.prefix FROM ai_apps a WHERE a.owner_id = t.owner_id AND a.build_id IS NULL
               AND a.revoked_at IS NULL ORDER BY a.created_at DESC LIMIT 1) AS active_prefix
     FROM orchestration_trials t LEFT JOIN ai_owner_spend s ON s.owner_id = t.owner_id
     ORDER BY t.created_at DESC LIMIT $1`,
    [Math.max(1, Math.min(1000, Math.floor(limit)))],
  );
  return res.rows.map((r) => ({ ...r, spent_usd: Number(r.spent_usd ?? 0) }));
}
