import { apiMember, json } from "@/matching/api-auth";
import { reasonText } from "@/matching/score";
import { matchesFor } from "@/matching/service";

/** GET /api/matching/matches — the active organization's matches, best first, each with its score and reasons. */
export async function GET(): Promise<Response> {
  const actor = await apiMember();
  if (!actor) return json({ error: "unauthorized" }, 401);
  const matches = await matchesFor(actor);
  return json({
    data: matches.map((m) => ({
      id: m.record.id,
      title: m.record.title,
      deadline: m.record.deadline,
      score: m.score,
      reasons: m.reasons.map((r) => ({ ...r, text: reasonText(r) })),
    })),
  });
}
