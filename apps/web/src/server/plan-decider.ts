import { decisionIO, type Decider } from "@turbineh/decider";
import { engine } from "@turbineh/decider/engine";

let cached: Decider | null | undefined;

/**
 * The decider for decisions taken while planning (ADR-0039 amendment: which app of a monorepo receives the
 * capability), from the installed resource decision engine (ADR-0058). Keys come from the server environment; null
 * when the engine has no backend configured — the caller then decides with code.
 */
export function planDecider(): Decider | null {
  if (cached !== undefined) return cached;
  cached = engine.forPlanning(process.env, decisionIO);
  return cached;
}
