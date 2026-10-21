import { z } from "zod";
import params from "./params.json";

/**
 * Matching parameters (component domain.matching.turbineh), written by TurbineH from the request: the word the app
 * uses for the records it matches (opportunity, tender, grant, lead…), the points each profile dimension is worth and
 * the minimum score a record needs to be shown as a match. Validated at start-up.
 */
const weight = z.number().int().min(0).max(10);
export const MatchingParams = z.object({
  entity: z.object({
    singular: z.string().trim().min(1).max(40),
    plural: z.string().trim().min(1).max(40),
  }),
  weights: z.object({ sectors: weight, activities: weight, regions: weight, keywords: weight }),
  minScore: z.number().int().min(0).max(100),
});
export type MatchingConfig = z.infer<typeof MatchingParams>;

export const matchingConfig: MatchingConfig = MatchingParams.parse(params);

/** "opportunity" → "Opportunity" (headings and buttons). */
export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Statuses a record can have; only open records are matched. */
export const RECORD_STATUSES = ["open", "closed"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/** Feedback a member gives on a record for their organization; "not_relevant" hides it from the matches. */
export const FEEDBACK = ["relevant", "not_relevant", "interested"] as const;
export type Feedback = (typeof FEEDBACK)[number];
export const FEEDBACK_LABEL: Record<Feedback, string> = {
  relevant: "Relevant",
  not_relevant: "Not relevant",
  interested: "Interested",
};
