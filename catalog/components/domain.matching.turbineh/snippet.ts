// A server page or action in the app: the active organization's best matches, each with the why of its score.
import { reasonText } from "@/matching/score";
import { matchesFor, type Actor } from "@/matching/service";

export async function topMatches(actor: Actor, count = 5): Promise<string[]> {
  const matches = await matchesFor(actor);
  return matches
    .slice(0, count)
    .map((m) => `${m.record.title} (score ${m.score}): ${m.reasons.map(reasonText).join(", ")}`);
}
