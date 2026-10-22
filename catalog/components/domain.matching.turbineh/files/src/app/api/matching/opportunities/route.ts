import { apiMember, json } from "@/matching/api-auth";
import { parsePage } from "@/lib/pagination";
import { parseFilters } from "@/matching/rules";
import { listRecords } from "@/matching/service";

/** GET /api/matching/opportunities?q=&sector=&region=&status=&before=&page= — the active organization's records only. */
export async function GET(request: Request): Promise<Response> {
  const actor = await apiMember();
  if (!actor) return json({ error: "unauthorized" }, 401);
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const { offset, limit } = parsePage(q.page);
  const rows = await listRecords(actor, parseFilters(q), { limit, offset });
  return json({ data: rows });
}
