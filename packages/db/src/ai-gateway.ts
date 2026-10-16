import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

/**
 * TurbineH AI gateway data (ADR-0029): per-app tokens, admission (rate limit + daily token quota) and usage records.
 * The plaintext token is returned once by createAiAppToken and never stored.
 */
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export const AI_TOKEN_PREFIX = "tbh_ai_";

export interface AiApp {
  id: string;
  ownerId: string;
  buildId: string | null;
  dailyTokenQuota: number;
  requestsPerMinute: number;
}

/** A new app token (plaintext, shown once), its display prefix and the hash that is stored. */
export function mintAiToken(): { token: string; prefix: string; tokenHash: string } {
  const token = `${AI_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, prefix: token.slice(0, 12), tokenHash: hash(token) };
}

export interface AiAppInput {
  ownerId: string;
  buildId: string | null;
  name: string;
  dailyTokenQuota: number;
  requestsPerMinute: number;
}

/**
 * Inside a transaction: revokes the owner's active token for the same build (when `buildId` is set) and inserts a new
 * one. Returns the plaintext once.
 */
export async function insertAiAppToken(
  client: pg.PoolClient,
  input: AiAppInput,
): Promise<{ id: string; token: string; prefix: string }> {
  const { token, prefix, tokenHash } = mintAiToken();
  if (input.buildId) {
    await client.query(
      "UPDATE ai_apps SET revoked_at = now() WHERE owner_id = $1 AND build_id = $2 AND revoked_at IS NULL",
      [input.ownerId, input.buildId],
    );
  }
  const res = await client.query<{ id: string }>(
    `INSERT INTO ai_apps (owner_id, build_id, name, token_hash, prefix, daily_token_quota, requests_per_minute)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.ownerId,
      input.buildId,
      input.name.slice(0, 80),
      tokenHash,
      prefix,
      input.dailyTokenQuota,
      input.requestsPerMinute,
    ],
  );
  return { id: res.rows[0]?.id ?? "", token, prefix };
}

/**
 * Creates the app token of a build, revoking any previous one (rotation). Returns the plaintext once.
 */
export async function createAiAppToken(
  db: pg.Pool,
  input: AiAppInput,
): Promise<{ id: string; token: string; prefix: string }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const created = await insertAiAppToken(client, input);
    await client.query("COMMIT");
    return created;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Active app for a presented token, or null (unknown, malformed or revoked). */
export async function verifyAiAppToken(db: pg.Pool, token: string): Promise<AiApp | null> {
  if (!token.startsWith(AI_TOKEN_PREFIX) || token.length > 100) return null;
  const res = await db.query<{
    id: string;
    owner_id: string;
    build_id: string | null;
    daily_token_quota: number;
    requests_per_minute: number;
  }>(
    `SELECT id, owner_id, build_id, daily_token_quota, requests_per_minute
     FROM ai_apps WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hash(token)],
  );
  const r = res.rows[0];
  return r
    ? {
        id: r.id,
        ownerId: r.owner_id,
        buildId: r.build_id,
        dailyTokenQuota: r.daily_token_quota,
        requestsPerMinute: r.requests_per_minute,
      }
    : null;
}

/** Revokes the active token of a build. True when one was revoked. */
export async function revokeAiAppToken(
  db: pg.Pool,
  ownerId: string,
  buildId: string,
): Promise<boolean> {
  const res = await db.query(
    "UPDATE ai_apps SET revoked_at = now() WHERE owner_id = $1 AND build_id = $2 AND revoked_at IS NULL",
    [ownerId, buildId],
  );
  return (res.rowCount ?? 0) > 0;
}

export type AdmitResult = { ok: true } | { ok: false; reason: "rate" | "quota" };

/**
 * Admission before forwarding: counts this request in the current minute (atomic upsert) and checks today's tokens.
 */
export async function admitAiRequest(db: pg.Pool, app: AiApp): Promise<AdmitResult> {
  const minute = await db.query<{ calls: number }>(
    `INSERT INTO ai_gateway_minute (app_id, minute, calls) VALUES ($1, date_trunc('minute', now()), 1)
     ON CONFLICT (app_id, minute) DO UPDATE SET calls = ai_gateway_minute.calls + 1 RETURNING calls`,
    [app.id],
  );
  if ((minute.rows[0]?.calls ?? 0) > app.requestsPerMinute) return { ok: false, reason: "rate" };
  const used = await db.query<{ tokens: string | null }>(
    `SELECT sum(input_tokens + output_tokens) AS tokens FROM ai_gateway_usage
     WHERE app_id = $1 AND day = current_date`,
    [app.id],
  );
  if (Number(used.rows[0]?.tokens ?? 0) >= app.dailyTokenQuota)
    return { ok: false, reason: "quota" };
  return { ok: true };
}

export async function recordAiUsage(
  db: pg.Pool,
  input: {
    appId: string;
    endpoint: "chat" | "embeddings" | "decider";
    model: string;
    inputTokens: number;
    outputTokens: number;
    /** Set when a hedge was fired for this request (ADR-0046); "hedge-won" counts a hedge win. */
    hedge?: "primary-won" | "hedge-won";
  },
): Promise<void> {
  await db.query(
    `INSERT INTO ai_gateway_usage (app_id, endpoint, model, calls, input_tokens, output_tokens, hedge_wins)
     VALUES ($1, $2, $3, 1, $4, $5, $6)
     ON CONFLICT (app_id, day, endpoint, model) DO UPDATE SET
       calls = ai_gateway_usage.calls + 1,
       input_tokens = ai_gateway_usage.input_tokens + EXCLUDED.input_tokens,
       output_tokens = ai_gateway_usage.output_tokens + EXCLUDED.output_tokens,
       hedge_wins = ai_gateway_usage.hedge_wins + EXCLUDED.hedge_wins`,
    [
      input.appId,
      input.endpoint,
      input.model.slice(0, 120),
      Math.max(0, Math.round(input.inputTokens)),
      Math.max(0, Math.round(input.outputTokens)),
      input.hedge === "hedge-won" ? 1 : 0,
    ],
  );
}

/**
 * Takes one hedge from the app's daily budget for a chat model (ADR-0046), atomically: allowed while today's hedges
 * are below max(minPerDay, ratio × today's chat calls of that model). True when the hedge may be fired.
 */
export async function reserveAiHedge(
  db: pg.Pool,
  input: { appId: string; model: string; ratio: number; minPerDay: number },
): Promise<boolean> {
  const res = await db.query<{ hedges: number }>(
    `INSERT INTO ai_gateway_usage AS u (app_id, endpoint, model, calls, hedges)
     SELECT $1, 'chat', $2, 0, 1
     WHERE $4::int >= 1 OR EXISTS (SELECT 1 FROM ai_gateway_usage
       WHERE app_id = $1 AND day = current_date AND endpoint = 'chat' AND model = $2)
     ON CONFLICT (app_id, day, endpoint, model) DO UPDATE SET hedges = u.hedges + 1
       WHERE u.hedges < GREATEST($4::int, floor(u.calls * $3::float8))
     RETURNING hedges`,
    [input.appId, input.model.slice(0, 120), input.ratio, input.minPerDay],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Trial spend of one TurbineH account across all of its AI apps (ADR-0053). */
export interface AiTrialStatus {
  spentUsd: number;
  capUsd: number;
  remainingUsd: number;
  reached: boolean;
}

/** Cumulative USD spend of an account (0 when it never used the gateway). */
export async function aiOwnerSpend(db: pg.Pool, ownerId: string): Promise<number> {
  const res = await db.query<{ spent_usd: string }>(
    "SELECT spent_usd FROM ai_owner_spend WHERE owner_id = $1",
    [ownerId],
  );
  return Number(res.rows[0]?.spent_usd ?? 0);
}

/** Trial status for a spend and a cap (cap ≤ 0 = no cap). */
export function trialStatus(spentUsd: number, capUsd: number): AiTrialStatus {
  const capped = capUsd > 0;
  return {
    spentUsd,
    capUsd,
    remainingUsd: capped ? Math.max(0, capUsd - spentUsd) : Number.POSITIVE_INFINITY,
    reached: capped && spentUsd >= capUsd,
  };
}

/**
 * Adds the cost of one gateway call to the account's spend, atomically (one upsert, safe under concurrent calls).
 * Returns the new total.
 */
export async function addAiOwnerSpend(db: pg.Pool, ownerId: string, usd: number): Promise<number> {
  const add = Number.isFinite(usd) && usd > 0 ? usd : 0;
  const res = await db.query<{ spent_usd: string }>(
    `INSERT INTO ai_owner_spend (owner_id, spent_usd) VALUES ($1, $2)
     ON CONFLICT (owner_id) DO UPDATE SET spent_usd = ai_owner_spend.spent_usd + EXCLUDED.spent_usd,
       updated_at = now()
     RETURNING spent_usd`,
    [ownerId, add.toFixed(8)],
  );
  return Number(res.rows[0]?.spent_usd ?? 0);
}

/** Housekeeping: minute counters older than a day. */
export async function pruneAiMinuteCounters(db: pg.Pool): Promise<void> {
  await db.query("DELETE FROM ai_gateway_minute WHERE minute < now() - interval '1 day'");
}

export interface AiAppSummary {
  active: { prefix: string; createdAt: string; dailyTokenQuota: number } | null;
  last30d: { calls: number; inputTokens: number; outputTokens: number };
  today: { calls: number; tokens: number };
}

/** Token status and usage of a build's AI app (for the build owner; no prices). */
export async function aiAppSummary(
  db: pg.Pool,
  ownerId: string,
  buildId: string,
): Promise<AiAppSummary> {
  const active = await db.query<{ prefix: string; created_at: Date; daily_token_quota: number }>(
    `SELECT prefix, created_at, daily_token_quota FROM ai_apps
     WHERE owner_id = $1 AND build_id = $2 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [ownerId, buildId],
  );
  const usage = await db.query<{
    calls: string | null;
    input: string | null;
    output: string | null;
    calls_today: string | null;
    tokens_today: string | null;
  }>(
    `SELECT sum(u.calls) AS calls, sum(u.input_tokens) AS input, sum(u.output_tokens) AS output,
            sum(u.calls) FILTER (WHERE u.day = current_date) AS calls_today,
            sum(u.input_tokens + u.output_tokens) FILTER (WHERE u.day = current_date) AS tokens_today
     FROM ai_gateway_usage u JOIN ai_apps a ON a.id = u.app_id
     WHERE a.owner_id = $1 AND a.build_id = $2 AND u.day > current_date - 30`,
    [ownerId, buildId],
  );
  const a = active.rows[0];
  const u = usage.rows[0];
  return {
    active: a
      ? {
          prefix: a.prefix,
          createdAt: new Date(a.created_at).toISOString(),
          dailyTokenQuota: a.daily_token_quota,
        }
      : null,
    last30d: {
      calls: Number(u?.calls ?? 0),
      inputTokens: Number(u?.input ?? 0),
      outputTokens: Number(u?.output ?? 0),
    },
    today: { calls: Number(u?.calls_today ?? 0), tokens: Number(u?.tokens_today ?? 0) },
  };
}

/** Internal (ops): AI usage per app over the last 7 days, by model. */
export async function aiUsageByApp(db: pg.Pool): Promise<
  {
    appId: string;
    name: string;
    ownerId: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    /** Hedged chat requests and how many hedges answered first (internal, ADR-0046). */
    hedges: number;
    hedgeWins: number;
  }[]
> {
  const res = await db.query<{
    app_id: string;
    name: string;
    owner_id: string;
    model: string;
    calls: string;
    input: string;
    output: string;
    hedges: string;
    hedge_wins: string;
  }>(
    `SELECT u.app_id, a.name, a.owner_id, u.model, sum(u.calls) AS calls,
            sum(u.input_tokens) AS input, sum(u.output_tokens) AS output,
            sum(u.hedges) AS hedges, sum(u.hedge_wins) AS hedge_wins
     FROM ai_gateway_usage u JOIN ai_apps a ON a.id = u.app_id
     WHERE u.day > current_date - 7
     GROUP BY 1, 2, 3, 4 ORDER BY sum(u.input_tokens + u.output_tokens) DESC LIMIT 50`,
  );
  return res.rows.map((r) => ({
    appId: r.app_id,
    name: r.name,
    ownerId: r.owner_id,
    model: r.model,
    calls: Number(r.calls),
    inputTokens: Number(r.input),
    outputTokens: Number(r.output),
    hedges: Number(r.hedges),
    hedgeWins: Number(r.hedge_wins),
  }));
}
