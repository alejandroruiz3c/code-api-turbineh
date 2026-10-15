import { phaseTimings, type PhaseTiming } from "@turbineh/db";
import { db } from "@/server/db";
import { requireCaller } from "@/server/product";

export const dynamic = "force-dynamic";

let cache: { at: number; rows: PhaseTiming[] } | null = null;

/**
 * GET /v1/activity/timings — typical duration of each live-trace phase (median of recent finished flows), for the
 * "this step usually takes ~N s" hints on the flow page (ADR-0051). Durations only: no cost, no flow data. Cached for
 * ten minutes per instance.
 */
export async function GET(): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  if (!cache || Date.now() - cache.at > 10 * 60_000) {
    const rows = await phaseTimings(db).catch(() => cache?.rows ?? []);
    cache = { at: Date.now(), rows };
  }
  const byKind = (kind: PhaseTiming["kind"]) =>
    Object.fromEntries(
      cache!.rows
        .filter((r) => r.kind === kind && r.samples >= 3)
        .map((r) => [r.phase, r.medianMs]),
    );
  return Response.json(
    { app: byKind("app"), component: byKind("component") },
    { headers: { "Cache-Control": "private, max-age=600" } },
  );
}
