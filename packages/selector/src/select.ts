import type {
  CapabilityDecision as EngineCapabilityDecision,
  Decider,
  SelectionInput as EngineSelectionInput,
  SelectionResult as EngineSelectionResult,
} from "@turbineh/decider";
import type { Candidate } from "@turbineh/resolver";
import { CAPABILITY_LABELS } from "./labels.js";

/** What the decider sees about a candidate: a short card, never the full manifest. */
export interface CandidateCard extends Candidate {
  card: string;
}

export type SelectionInput = EngineSelectionInput<CandidateCard>;
export type CapabilityDecision = EngineCapabilityDecision<CandidateCard>;
export type SelectionResult = EngineSelectionResult<CandidateCard>;

/**
 * One selection for the whole build: per capability, the eligible candidates ranked best first, or a Backup Coder
 * trigger (T1 no candidate, T2 none covers it). The decision itself belongs to the resource decision engine
 * (ADR-0058): TurbineH's private engine in production, the open fallback (approved providers, catalogue order) here.
 */
export function selectComponents(
  input: SelectionInput,
  decider: Pick<Decider, "selectComponents">,
): Promise<SelectionResult> {
  return decider.selectComponents({ ...input, labels: input.labels ?? CAPABILITY_LABELS });
}
