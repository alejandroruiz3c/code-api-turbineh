import type pg from "pg";

/**
 * Product flows (PLAN §16.4) live on the builds table: the row first carries the plan (`options.mode = "plan"`,
 * `metrics.plan`), then the generation from that plan (`options.mode = "generate"`), then integrations reported by
 * the CLI or the repository integration (`metrics.integrations`).
 */

/**
 * Approved plan → queue its generation on the same row (keeps the plan and the event trace). A generation that
 * failed without delivering anything can be queued again the same way ("Generate again", ADR-0050): the plan and its
 * spec are kept, so it resumes from the approved plan.
 */
export async function requeueForGeneration(
  db: pg.Pool,
  id: string,
  ownerId: string,
): Promise<boolean> {
  const res = await db.query(
    `UPDATE builds SET status = 'queued', options = options || '{"mode":"generate"}'::jsonb, attempts = 0,
       claimed_by = NULL, claimed_at = NULL, error = NULL, finished_at = NULL
     WHERE id = $1 AND owner_id = $2 AND metrics ? 'plan'
       AND ((status = 'done' AND options->>'mode' = 'plan')
         OR (status = 'failed' AND options->>'mode' = 'generate' AND NOT coalesce(artifact ? 'zipKey', false)))
     RETURNING id`,
    [id, ownerId],
  );
  if (!res.rows[0]) return false;
  await db.query(
    "INSERT INTO build_events (build_id, phase, type, data) VALUES ($1, 'queued', 'queued', '{\"mode\":\"generate\"}')",
    [id],
  );
  return true;
}

/** Appends an integration record (integrated, integration_verified, reverted…) to the flow. */
export async function recordIntegration(
  db: pg.Pool,
  id: string,
  ownerId: string,
  record: Record<string, unknown>,
): Promise<boolean> {
  const res = await db.query(
    `UPDATE builds SET metrics = jsonb_set(metrics, '{integrations}',
       coalesce(metrics->'integrations', '[]'::jsonb) || $3::jsonb)
     WHERE id = $1 AND owner_id = $2 AND status = 'done' RETURNING id`,
    [id, ownerId, JSON.stringify([record])],
  );
  return Boolean(res.rows[0]);
}

export interface FlowListRow {
  id: string;
  need: string;
  status: string;
  mode: string | null;
  created_at: string;
  finished_at: string | null;
  error: string | null;
  options: Record<string, unknown>;
  metrics: Record<string, unknown>;
  artifact: Record<string, unknown> | null;
}

/** Flows of a workspace, newest first (metrics trimmed to what the activity view needs). */
export async function listFlows(db: pg.Pool, ownerId: string, limit = 50): Promise<FlowListRow[]> {
  const res = await db.query<FlowListRow>(
    `SELECT id, prompt AS need, status, options->>'mode' AS mode, created_at, finished_at, error, options,
       jsonb_build_object(
         'plan', metrics->'plan', 'verify', metrics->'verify', 'timings', metrics->'timings',
         'reuse', metrics->'reuse', 'handover', metrics->'handover', 'integrations', metrics->'integrations',
         'tokens', metrics->'tokens', 'integrated', metrics->'integrated', 'backup', metrics->'backup',
         'corrections', metrics->'corrections', 'deployment', metrics->'deployment'
       ) AS metrics,
       artifact
     FROM builds WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [ownerId, Math.min(Math.max(limit, 1), 200)],
  );
  return res.rows.map((r) => ({
    ...r,
    metrics: Object.fromEntries(Object.entries(r.metrics).filter(([, v]) => v !== null)),
  }));
}

export interface CatalogRow {
  id: string;
  version: string;
  category: string;
  provides: string[];
  license: string;
  purl: string;
  does: string;
  useCases: string[];
  docs?: unknown;
}

/** Approved components for search (the catalog table, synced from the manifests). */
export async function approvedCatalog(db: pg.Pool): Promise<CatalogRow[]> {
  const res = await db.query<CatalogRow>(
    `SELECT id, version, category, provides, coalesce(license, '') AS license, purl,
       coalesce(manifest->'capability'->>'does', '') AS does,
       coalesce(ARRAY(SELECT jsonb_array_elements_text(manifest->'capability'->'use_cases')), '{}') AS "useCases",
       manifest->'docs' AS docs
     FROM components WHERE status = 'approved' ORDER BY id`,
  );
  return res.rows;
}
