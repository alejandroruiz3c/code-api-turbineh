// Server code in the app (e.g. a staff action): the same deterministic matching the assistant uses.
import { recommendationConfig as cfg } from "@/recommendations/config";
import { formatMoney } from "@/recommendations/search";
import { recommend } from "@/recommendations/store";

export async function shortlist(budgetMax: number, location: string) {
  const found = await recommend({ budgetMax, location, needs: {} }); // verified, active, within budget, in that place
  return found.map((i) => `${i.reference}: ${i.title} — ${formatMoney(i.price, cfg.currency)}`);
}

export const example = () => shortlist(320_000, "Valencia");
