import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";

export type BuildStatus =
  | "queued"
  | "guarding"
  | "compiling"
  | "selecting"
  | "resolving"
  | "assembling"
  | "verifying"
  | "delivering"
  | "done"
  | "failed";

export interface BuildRow {
  id: string;
  prompt: string;
  status: BuildStatus;
  owner_id: string | null;
  options: Record<string, unknown>;
  spec: unknown;
  metrics: Record<string, unknown>;
  artifact: Record<string, unknown> | null;
  repo_url: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  /**
   * Start of the row's current run (ADR-0066): when it was last queued (the generation of an approved plan is queued
   * again on the same row), else when it was created. Read by `getBuild` only.
   */
  started_at?: string | null;
}

/** SQL for the start of a build's current run (ADR-0066); `b` is the builds row alias. */
export const RUN_STARTED_AT_SQL = `coalesce(
  (SELECT max(e.at) FROM build_events e WHERE e.build_id = b.id AND e.type = 'queued'), b.created_at)`;

export interface BuildEvent {
  id: number;
  phase: string;
  type: string;
  data: Record<string, unknown>;
  at: string;
}

/** Enqueues a build. With an idempotency key, the same owner gets the same build back instead of a duplicate. */
export async function enqueueBuild(
  db: pg.Pool,
  input: {
    prompt: string;
    ownerId: string;
    apiKeyId?: string;
    idempotencyKey?: string;
    options?: Record<string, unknown>;
    /** HMAC of the client IP (never the IP itself), for the per-IP daily quota. */
    clientIpHash?: string;
  },
): Promise<{ id: string; created: boolean }> {
  if (input.idempotencyKey) {
    const existing = await db.query<{ id: string }>(
      "SELECT id FROM builds WHERE owner_id = $1 AND idempotency_key = $2",
      [input.ownerId, input.idempotencyKey],
    );
    if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO builds (id, prompt, status, owner_id, api_key_id, idempotency_key, options, client_ip_hash)
     VALUES ($1, $2, 'queued', $3, $4, $5, $6, $7)
     ON CONFLICT (owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [
      id,
      input.prompt,
      input.ownerId,
      input.apiKeyId ?? null,
      input.idempotencyKey ?? null,
      input.options ?? {},
      input.clientIpHash ?? null,
    ],
  );
  await db.query(
    "INSERT INTO build_events (build_id, phase, type, data) VALUES ($1, 'queued', 'queued', '{}')",
    [id],
  );
  return { id, created: true };
}

/** Claims the oldest queued build for this worker (safe with many workers). */
export async function claimBuild(db: pg.Pool, workerId: string): Promise<BuildRow | null> {
  const res = await db.query<BuildRow>(
    `UPDATE builds SET status = 'guarding', claimed_by = $1, claimed_at = now(), attempts = attempts + 1
     WHERE id = (
       SELECT id FROM builds WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
     )
     RETURNING *`,
    [workerId],
  );
  return res.rows[0] ?? null;
}

/** Builds stuck in a running state (crashed worker) go back to the queue, at most twice. */
export async function requeueStale(db: pg.Pool, olderThanMinutes = 15): Promise<number> {
  const res = await db.query(
    `UPDATE builds SET status = CASE WHEN attempts >= 2 THEN 'failed' ELSE 'queued' END,
       error = CASE WHEN attempts >= 2 THEN 'worker lost the build twice' ELSE error END
     WHERE status NOT IN ('queued','done','failed') AND claimed_at < now() - make_interval(mins => $1)`,
    [olderThanMinutes],
  );
  return res.rowCount ?? 0;
}

export async function emitEvent(
  db: pg.Pool,
  buildId: string,
  phase: string,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  await db.query("INSERT INTO build_events (build_id, phase, type, data) VALUES ($1, $2, $3, $4)", [
    buildId,
    phase,
    type,
    data,
  ]);
  if (
    [
      "guarding",
      "compiling",
      "selecting",
      "resolving",
      "assembling",
      "verifying",
      "delivering",
    ].includes(phase)
  ) {
    await db.query(
      "UPDATE builds SET status = $2 WHERE id = $1 AND status NOT IN ('done','failed')",
      [buildId, phase],
    );
  }
}

export async function finishBuild(
  db: pg.Pool,
  id: string,
  result: {
    status: "done" | "failed";
    spec?: unknown;
    metrics: Record<string, unknown>;
    artifact?: Record<string, unknown>;
    error?: string;
  },
): Promise<void> {
  await db.query(
    "UPDATE builds SET status = $2, spec = $3, metrics = $4, artifact = $5, error = $6, finished_at = now() WHERE id = $1",
    [
      id,
      result.status,
      result.spec ?? null,
      result.metrics,
      result.artifact ?? null,
      result.error ?? null,
    ],
  );
}

export async function getBuild(
  db: pg.Pool,
  id: string,
  ownerId?: string,
): Promise<BuildRow | null> {
  const res = await db.query<BuildRow>(
    `SELECT id, prompt, status, owner_id, options, spec, metrics, artifact, repo_url, error, created_at, finished_at,
            ${RUN_STARTED_AT_SQL} AS started_at
     FROM builds b WHERE id = $1 ${ownerId ? "AND owner_id = $2" : ""}`,
    ownerId ? [id, ownerId] : [id],
  );
  return res.rows[0] ?? null;
}

/** The single "Improve & redeliver" build of a parent build, if one was requested. */
export async function findImprovement(
  db: pg.Pool,
  parentId: string,
  ownerId: string,
): Promise<{ id: string; status: string } | null> {
  const res = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM builds
     WHERE owner_id = $1 AND options->>'mode' = 'improve' AND options->>'parent' = $2
     ORDER BY created_at LIMIT 1`,
    [ownerId, parentId],
  );
  return res.rows[0] ?? null;
}

/** One finished run of a recipe, as persisted (ADR-0066): its start, its end and its metrics. */
export interface RunHistoryRow {
  id: string;
  recipe: string;
  started_at: string;
  finished_at: string;
  metrics: Record<string, unknown>;
}

/**
 * Finished app runs of a recipe that delivered a package (verified, or delivered not verified), most recent first:
 * the history plan estimates are calibrated on (ADR-0066). Plan-only runs and "Improve & re-verify" runs are left
 * out — they do a different amount of work.
 */
export async function runHistory(
  db: pg.Pool,
  opts: { recipe?: string; limit?: number; days?: number } = {},
): Promise<RunHistoryRow[]> {
  const res = await db.query<RunHistoryRow>(
    `SELECT b.id, b.metrics->'recipe'->>'built' AS recipe, ${RUN_STARTED_AT_SQL} AS started_at, b.finished_at,
            b.metrics
     FROM builds b
     WHERE b.finished_at IS NOT NULL
       AND (b.status = 'done' OR coalesce(b.artifact ? 'zipKey', false))
       AND b.metrics->'recipe'->>'built' IS NOT NULL
       AND coalesce(b.options->>'mode', 'build') NOT IN ('plan', 'improve')
       AND ($1::text IS NULL OR b.metrics->'recipe'->>'built' = $1)
       AND b.finished_at > now() - make_interval(days => $3)
     ORDER BY b.finished_at DESC LIMIT $2`,
    [opts.recipe ?? null, opts.limit ?? 50, opts.days ?? 180],
  );
  return res.rows;
}

/** Typical duration of each phase in recent finished flows, per kind of run (ADR-0051, internal timings only). */
export interface PhaseTiming {
  kind: "app" | "component";
  phase: string;
  medianMs: number;
  samples: number;
}

/**
 * Median duration of each live-trace phase over the last finished runs (14 days, at most 300 builds). A phase lasts
 * from the event before its first event to its last event, within one run (a row carries the plan run and then the
 * generation run, each starting at a `queued` event). Component-only packages and complete apps are kept apart.
 */
export async function phaseTimings(db: pg.Pool): Promise<PhaseTiming[]> {
  const res = await db.query<{
    kind: "app" | "component";
    phase: string;
    median_ms: number;
    samples: number;
  }>(
    `WITH recent AS (
       SELECT id, CASE WHEN metrics->'plan'->'capability'->>'kind' = 'component' THEN 'component' ELSE 'app' END AS kind
       FROM builds WHERE status = 'done' AND finished_at > now() - interval '14 days'
       ORDER BY finished_at DESC LIMIT 300
     ), runs AS (
       SELECT e.build_id, e.id, e.phase, e.at, r.kind,
              SUM(CASE WHEN e.type = 'queued' THEN 1 ELSE 0 END) OVER (PARTITION BY e.build_id ORDER BY e.id) AS run
       FROM build_events e JOIN recent r ON r.id = e.build_id
     ), ev AS (
       SELECT build_id, run, kind, phase, at, lag(at) OVER (PARTITION BY build_id, run ORDER BY id) AS prev FROM runs
     ), per AS (
       SELECT kind, phase, EXTRACT(EPOCH FROM (max(at) - min(prev))) * 1000 AS ms
       FROM ev WHERE prev IS NOT NULL AND phase NOT IN ('queued', 'done', 'failed')
       GROUP BY build_id, run, kind, phase
     )
     SELECT kind, phase, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms))::int AS median_ms, count(*)::int AS samples
     FROM per GROUP BY kind, phase`,
  );
  return res.rows.map((r) => ({
    kind: r.kind,
    phase: r.phase,
    medianMs: Number(r.median_ms),
    samples: Number(r.samples),
  }));
}

export async function eventsSince(
  db: pg.Pool,
  buildId: string,
  afterId: number,
): Promise<BuildEvent[]> {
  const res = await db.query<BuildEvent>(
    "SELECT id, phase, type, data, at FROM build_events WHERE build_id = $1 AND id > $2 ORDER BY id LIMIT 200",
    [buildId, afterId],
  );
  return res.rows.map((r) => ({ ...r, id: Number(r.id) }));
}

export async function setRepoUrl(db: pg.Pool, id: string, url: string): Promise<void> {
  await db.query("UPDATE builds SET repo_url = $2 WHERE id = $1", [id, url]);
}

// ── API keys ────────────────────────────────────────────────────────────────────────────────────────────────

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Creates an API key; the plaintext is returned once and never stored. */
export async function createApiKey(
  db: pg.Pool,
  ownerId: string,
  name: string,
  dailyQuota = 20,
): Promise<{ id: string; key: string }> {
  const key = `tbh_${randomBytes(24).toString("base64url")}`;
  const res = await db.query<{ id: string }>(
    "INSERT INTO api_keys (owner_id, name, key_hash, prefix, daily_quota) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [ownerId, name, hashKey(key), key.slice(0, 8), dailyQuota],
  );
  return { id: res.rows[0]?.id ?? "", key };
}

/** Active keys of an owner (never the key itself: only prefix and metadata). */
export async function listApiKeys(
  db: pg.Pool,
  ownerId: string,
): Promise<
  { id: string; name: string; prefix: string; daily_quota: number; created_at: string }[]
> {
  const res = await db.query<{
    id: string;
    name: string;
    prefix: string;
    daily_quota: number;
    created_at: string;
  }>(
    "SELECT id, name, prefix, daily_quota, created_at FROM api_keys WHERE owner_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC",
    [ownerId],
  );
  return res.rows;
}

export async function revokeApiKey(db: pg.Pool, ownerId: string, id: string): Promise<boolean> {
  const res = await db.query(
    "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND owner_id = $2 AND revoked_at IS NULL",
    [id, ownerId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function verifyApiKey(
  db: pg.Pool,
  key: string,
): Promise<{ id: string; ownerId: string; dailyQuota: number } | null> {
  if (!/^tbh_[A-Za-z0-9_-]{20,}$/.test(key)) return null;
  const res = await db.query<{ id: string; owner_id: string; daily_quota: number }>(
    "SELECT id, owner_id, daily_quota FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
    [hashKey(key)],
  );
  const row = res.rows[0];
  return row ? { id: row.id, ownerId: row.owner_id, dailyQuota: row.daily_quota } : null;
}

/** Builds created by this owner in the last 24 h. */
export async function buildsLastDay(db: pg.Pool, ownerId: string): Promise<number> {
  const res = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM builds WHERE owner_id = $1 AND created_at > now() - interval '1 day'",
    [ownerId],
  );
  return Number(res.rows[0]?.n ?? 0);
}

/** Builds started from this client (HMAC of the IP) in the last 24 h, across all accounts. */
export async function buildsLastDayFromIp(db: pg.Pool, clientIpHash: string): Promise<number> {
  const res = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM builds WHERE client_ip_hash = $1 AND created_at > now() - interval '1 day'",
    [clientIpHash],
  );
  return Number(res.rows[0]?.n ?? 0);
}

// ── Selection cache (PLAN §9, ADR-0027) ────────────────────────────────────────────────────────────────────

/** Cached selection for this key, if younger than `maxAgeDays` (a hit is counted). */
export async function getCachedSelection<T>(
  db: pg.Pool,
  key: string,
  maxAgeDays = 7,
): Promise<T | null> {
  const res = await db.query<{ result: T }>(
    `UPDATE selection_cache SET hits = hits + 1, last_hit_at = now()
     WHERE key = $1 AND created_at > now() - make_interval(days => $2) RETURNING result`,
    [key, maxAgeDays],
  );
  return res.rows[0]?.result ?? null;
}

export async function putCachedSelection(db: pg.Pool, key: string, result: unknown): Promise<void> {
  await db.query(
    `INSERT INTO selection_cache (key, result) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET result = EXCLUDED.result, created_at = now(), hits = 0`,
    [key, JSON.stringify(result)],
  );
  await db.query("DELETE FROM selection_cache WHERE created_at < now() - interval '30 days'");
}

// ── Cost circuit breaker (ADR-0008) ────────────────────────────────────────────────────────────────────────

export async function addCost(db: pg.Pool, eur: number): Promise<void> {
  await db.query(
    `INSERT INTO cost_ledger (day, builds, eur) VALUES (current_date, 1, $1)
     ON CONFLICT (day) DO UPDATE SET builds = cost_ledger.builds + 1, eur = cost_ledger.eur + $1`,
    [eur],
  );
}

export async function costToday(db: pg.Pool): Promise<{ builds: number; eur: number }> {
  const res = await db.query<{ builds: number; eur: string }>(
    "SELECT builds, eur FROM cost_ledger WHERE day = current_date",
  );
  return { builds: res.rows[0]?.builds ?? 0, eur: Number(res.rows[0]?.eur ?? 0) };
}

// ── Worker heartbeat (/health) ─────────────────────────────────────────────────────────────────────────────

export async function heartbeat(db: pg.Pool, workerId: string, running: number): Promise<void> {
  await db.query(
    `INSERT INTO worker_heartbeats (worker_id, seen_at, running) VALUES ($1, now(), $2)
     ON CONFLICT (worker_id) DO UPDATE SET seen_at = now(), running = $2`,
    [workerId, running],
  );
  await db.query("DELETE FROM worker_heartbeats WHERE seen_at < now() - interval '1 day'");
}

/** Workers seen in the last 90 s, builds they are running and builds waiting in the queue. */
export async function workerStatus(
  db: pg.Pool,
): Promise<{ workers: number; running: number; queued: number }> {
  const res = await db.query<{ workers: number; running: number; queued: number }>(
    `SELECT
       (SELECT count(*)::int FROM worker_heartbeats WHERE seen_at > now() - interval '90 seconds') AS workers,
       (SELECT coalesce(sum(running), 0)::int FROM worker_heartbeats WHERE seen_at > now() - interval '90 seconds') AS running,
       (SELECT count(*)::int FROM builds WHERE status = 'queued') AS queued`,
  );
  return res.rows[0] ?? { workers: 0, running: 0, queued: 0 };
}
