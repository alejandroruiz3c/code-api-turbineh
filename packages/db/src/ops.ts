import type pg from "pg";

/** Internal operations snapshot (PLAN §9 observability): throughput, green rate, timing, queue, workers, cost. */
export interface OpsSnapshot {
  builds: { lastHour: number; last24h: number; perMinuteLastHour: number };
  green24h: { done: number; failed: number; rate: number | null };
  avgDurationS24h: number | null;
  queue: { queued: number; running: number };
  workers: { id: string; running: number; seenSecondsAgo: number }[];
  cost: { todayEur: number; buildsToday: number; avgPerBuildEur7d: number | null };
  byWorker24h: { worker: string; builds: number; avgDurationS: number | null; failed: number }[];
  recentFailures: { id: string; at: string; error: string | null; worker: string | null }[];
}

export async function opsSnapshot(db: pg.Pool): Promise<OpsSnapshot> {
  const one = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;
  const [counts] = await one<{
    h1: number;
    h24: number;
    done: number;
    failed: number;
    avg_s: number | null;
  }>(
    `SELECT
       count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS h1,
       count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS h24,
       count(*) FILTER (WHERE finished_at > now() - interval '1 day' AND status = 'done')::int AS done,
       count(*) FILTER (WHERE finished_at > now() - interval '1 day' AND status = 'failed')::int AS failed,
       avg(extract(epoch FROM finished_at - claimed_at)) FILTER (
         WHERE finished_at > now() - interval '1 day' AND claimed_at IS NOT NULL) AS avg_s
     FROM builds WHERE created_at > now() - interval '2 days'`,
  );
  const [queue] = await one<{ queued: number; running: number }>(
    `SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued,
            count(*) FILTER (WHERE status NOT IN ('queued','done','failed'))::int AS running
     FROM builds WHERE created_at > now() - interval '2 days'`,
  );
  const workers = await one<{ worker_id: string; running: number; ago: number }>(
    `SELECT worker_id, running, extract(epoch FROM now() - seen_at)::int AS ago
     FROM worker_heartbeats WHERE seen_at > now() - interval '10 minutes' ORDER BY worker_id`,
  );
  const [cost] = await one<{ eur: string | null; builds: number | null }>(
    "SELECT eur, builds FROM cost_ledger WHERE day = current_date",
  );
  const [avg7] = await one<{ avg: string | null }>(
    "SELECT sum(eur) / nullif(sum(builds), 0) AS avg FROM cost_ledger WHERE day > current_date - 7",
  );
  const byWorker = await one<{
    worker: string;
    builds: number;
    avg_s: number | null;
    failed: number;
  }>(
    `SELECT regexp_replace(claimed_by, '-[0-9]+$', '') AS worker, count(*)::int AS builds,
            avg(extract(epoch FROM finished_at - claimed_at)) AS avg_s,
            count(*) FILTER (WHERE status = 'failed')::int AS failed
     FROM builds WHERE finished_at > now() - interval '1 day' AND claimed_by IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC`,
  );
  const failures = await one<{
    id: string;
    at: Date;
    error: string | null;
    claimed_by: string | null;
  }>(
    `SELECT id, finished_at AS at, error, claimed_by FROM builds
     WHERE status = 'failed' AND finished_at > now() - interval '1 day' ORDER BY finished_at DESC LIMIT 10`,
  );
  const done = counts?.done ?? 0;
  const failed = counts?.failed ?? 0;
  const round = (n: number | null | undefined) => (n == null ? null : Math.round(Number(n)));
  return {
    builds: {
      lastHour: counts?.h1 ?? 0,
      last24h: counts?.h24 ?? 0,
      perMinuteLastHour: Number(((counts?.h1 ?? 0) / 60).toFixed(2)),
    },
    green24h: {
      done,
      failed,
      rate: done + failed ? Number((done / (done + failed)).toFixed(3)) : null,
    },
    avgDurationS24h: round(counts?.avg_s),
    queue: { queued: queue?.queued ?? 0, running: queue?.running ?? 0 },
    workers: workers.map((w) => ({ id: w.worker_id, running: w.running, seenSecondsAgo: w.ago })),
    cost: {
      todayEur: Number(cost?.eur ?? 0),
      buildsToday: cost?.builds ?? 0,
      avgPerBuildEur7d: avg7?.avg == null ? null : Number(Number(avg7.avg).toFixed(5)),
    },
    byWorker24h: byWorker.map((w) => ({
      worker: w.worker,
      builds: w.builds,
      avgDurationS: round(w.avg_s),
      failed: w.failed,
    })),
    recentFailures: failures.map((f) => ({
      id: f.id,
      at: new Date(f.at).toISOString(),
      error: f.error,
      worker: f.claimed_by,
    })),
  };
}
