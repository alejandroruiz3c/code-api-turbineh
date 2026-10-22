import { apiMember, json } from "@/matching/api-auth";
import { getRecord } from "@/matching/service";

/** GET /api/matching/opportunities/{id} — one record of the active organization; any other id is 404. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await apiMember();
  if (!actor) return json({ error: "unauthorized" }, 401);
  const record = await getRecord(actor, (await params).id);
  return record ? json({ data: record }) : json({ error: "not_found" }, 404);
}
