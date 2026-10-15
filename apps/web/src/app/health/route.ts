import { workerStatus } from "@turbineh/db";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness: database reachable, workers seen in the last 90 s and queue length (no hostnames exposed). */
export async function GET(): Promise<Response> {
  const status = await workerStatus(db).catch(() => null);
  const ok = status !== null;
  return Response.json(
    {
      ok,
      service: "code-api-turbineh",
      ...(status ? { worker: status.workers > 0 ? "up" : "down", ...status } : {}),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
