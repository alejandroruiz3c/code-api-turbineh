import { choice, noul, type Decider, type Questions } from "@turbineh/decider";
import type { Candidate } from "@turbineh/resolver";
import { capabilityLabel } from "./labels.js";

/** What the decider sees about a candidate: a short card, never the full manifest. */
export interface CandidateCard extends Candidate {
  card: string;
}

export interface SelectionInput {
  app: { recipe: string; summary: string; acceptance_criteria: string[] };
  /** Candidates per capability, already filtered to the capability (catalog lookup / retrieval). */
  candidates: Record<string, CandidateCard[]>;
}

export interface CapabilityDecision {
  capability: string;
  /** Candidates ranked by the decider: best choice first, then by coverage probability. */
  ranked: CandidateCard[];
  best: { id: string; p: number } | null;
  covers: Record<string, number>;
  risk: Record<string, number>;
  /** Backup Coder triggers (PLAN §2.4): T1 no candidate, T2 none covers the capability. */
  trigger: "T1" | "T2" | null;
}

export interface SelectionResult {
  decisions: CapabilityDecision[];
  decider: {
    backend: string;
    model: string;
    latencyMs: number;
    requests: number;
    questions: number;
  };
}

/** Policy thresholds live in code (per decision point). */
/** Risk only blocks clear cases; dependency security is decided by deterministic scans (OSV, licenses, gitleaks). */
export const POLICY = { coversMin: 0.5, riskMax: 0.5 } as const;

const key = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "_");

/**
 * One batched decider request for the whole build: per capability one Choice (best candidate) and, per
 * candidate, two atomic Nouls (covers the capability? introduces an unmitigated risk?).
 */
export async function selectComponents(
  input: SelectionInput,
  decider: Decider,
): Promise<SelectionResult> {
  const state = {
    app: input.app,
    capabilities: Object.fromEntries(
      Object.entries(input.candidates)
        .filter(([, cs]) => cs.length > 0)
        .map(([cap, cs]) => [cap, Object.fromEntries(cs.map((c) => [c.id, c.card]))]),
    ),
  };
  const questions: Questions = {};
  for (const [cap, cs] of Object.entries(input.candidates)) {
    if (cs.length === 0) continue;
    const need = capabilityLabel(cap);
    questions[`best:${key(cap)}`] = choice(
      `Which candidate in \`capabilities.${cap}\` is the best fit for ${need} in \`app\`?`,
      Object.fromEntries(cs.map((c) => [c.id, null])),
    );
    for (const c of cs) {
      questions[`covers:${key(cap)}:${key(c.id)}`] = noul(
        `Candidate \`capabilities.${cap}.${c.id}\` offers ${need}.`,
      );
      questions[`risk:${key(cap)}:${key(c.id)}`] = noul(
        `Candidate \`capabilities.${cap}.${c.id}\` is described as unsafe or insecure.`,
      );
    }
  }

  const decisions: CapabilityDecision[] = [];
  if (Object.keys(questions).length === 0) {
    return {
      decisions: Object.keys(input.candidates).map((capability) => ({
        capability,
        ranked: [],
        best: null,
        covers: {},
        risk: {},
        trigger: "T1",
      })),
      decider: { backend: decider.id, model: "-", latencyMs: 0, requests: 0, questions: 0 },
    };
  }

  const d = await decider.ask(state, questions);
  for (const [cap, cs] of Object.entries(input.candidates)) {
    if (cs.length === 0) {
      decisions.push({
        capability: cap,
        ranked: [],
        best: null,
        covers: {},
        risk: {},
        trigger: "T1",
      });
      continue;
    }
    const bestAnswer = d.answers[`best:${key(cap)}`];
    const pBest = bestAnswer?.type === "choice" ? bestAnswer.probabilities : {};
    const covers: Record<string, number> = {};
    const risk: Record<string, number> = {};
    for (const c of cs) {
      const cv = d.answers[`covers:${key(cap)}:${key(c.id)}`];
      const rk = d.answers[`risk:${key(cap)}:${key(c.id)}`];
      covers[c.id] = cv?.type === "noul" ? cv.noul : 0;
      risk[c.id] = rk?.type === "noul" ? rk.noul : 1;
    }
    const eligible = cs.filter(
      (c) => (covers[c.id] ?? 0) >= POLICY.coversMin && (risk[c.id] ?? 1) <= POLICY.riskMax,
    );
    const ranked = [...eligible].sort(
      (a, b) =>
        (pBest[b.id] ?? 0) - (pBest[a.id] ?? 0) || (covers[b.id] ?? 0) - (covers[a.id] ?? 0),
    );
    const top = ranked[0];
    decisions.push({
      capability: cap,
      ranked,
      best: top ? { id: top.id, p: pBest[top.id] ?? 0 } : null,
      covers,
      risk,
      trigger: ranked.length === 0 ? "T2" : null,
    });
  }
  return {
    decisions,
    decider: {
      backend: d.meta.backend,
      model: d.meta.model,
      latencyMs: d.meta.latencyMs,
      requests: d.meta.requests,
      questions: Object.keys(questions).length,
    },
  };
}
