import type pg from "pg";

/**
 * Demand for use cases the library does not cover yet (ADR-0052). The worker records every refused (or partially
 * covered) request and subscribes its owner to a priority notification; the owner reads the list (staff only).
 */
export interface DemandInput {
  buildId: string | null;
  ownerId: string | null;
  email: string | null;
  request: string;
  status: "uncovered" | "partial";
  useCase: string | null;
  missing: { requirement: string; why: string }[];
}

export async function recordDemand(db: pg.Pool, d: DemandInput): Promise<void> {
  await db.query(
    `INSERT INTO use_case_demand (build_id, owner_id, email, request, status, use_case, missing)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (build_id) WHERE build_id IS NOT NULL DO NOTHING`,
    [
      d.buildId,
      d.ownerId,
      d.email,
      d.request.slice(0, 20_000),
      d.status,
      d.useCase,
      JSON.stringify(d.missing.slice(0, 50)),
    ],
  );
  if (!d.ownerId) return;
  await db.query(
    `INSERT INTO priority_notifications (owner_id, email) VALUES ($1, $2)
     ON CONFLICT (owner_id) DO UPDATE SET
       email = coalesce(EXCLUDED.email, priority_notifications.email),
       last_request_at = now(),
       requests = priority_notifications.requests + 1`,
    [d.ownerId, d.email],
  );
}

export interface DemandRow {
  id: number;
  build_id: string | null;
  owner_id: string | null;
  email: string | null;
  request: string;
  status: "uncovered" | "partial";
  use_case: string | null;
  missing: { requirement: string; why: string }[];
  created_at: string;
  subscribed: boolean;
}

/** Newest first, with whether the owner is subscribed to the priority notification. */
export async function listDemand(db: pg.Pool, limit = 100): Promise<DemandRow[]> {
  const res = await db.query<DemandRow>(
    `SELECT d.id, d.build_id, d.owner_id, coalesce(d.email, p.email) AS email, d.request, d.status, d.use_case,
            d.missing, d.created_at, (p.owner_id IS NOT NULL AND p.notified_at IS NULL) AS subscribed
     FROM use_case_demand d LEFT JOIN priority_notifications p ON p.owner_id = d.owner_id
     ORDER BY d.created_at DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 1000)],
  );
  return res.rows;
}
