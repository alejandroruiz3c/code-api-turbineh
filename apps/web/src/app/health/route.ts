import { workerStatus } from "@turbineh/db";
import { db } from "@/server/db";
import { getStaff } from "@/server/staff";

export const dynamic = "force-dynamic";

/**
 * Liveness: database reachable and whether a worker was seen in the last 90 s. Public callers get only `ok`, `service`
 * and `worker` ("up"/"down"); worker counts and queue length are for signed-in staff (audit I-20).
 */
export async function GET(): Promise<Response> {
  const status = await workerStatus(db).catch(() => null);
  const ok = status !== null;
  const staff = status ? await getStaff().catch(() => null) : null;
  return Response.json(
    {
      ok,
      service: "code-api-turbineh",
      ...(status ? { worker: status.workers > 0 ? "up" : "down", ...(staff ? status : {}) } : {}),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
