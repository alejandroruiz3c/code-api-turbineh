/** Every labelled criterion → test pair (generated, decider and hand-written rules), for recall measurements. */
import { PROOF_PAIRS } from "./criterion-proof.fixtures.js";
import { RULE_PAIRS } from "./criterion-proof.rule-fixtures.js";

export type { ProofPair } from "./criterion-proof.fixtures.js";
export const LABELLED_PAIRS = [...PROOF_PAIRS, ...RULE_PAIRS];
