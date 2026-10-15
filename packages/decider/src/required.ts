/**
 * Production must run TurbineH's private engines (ADR-0053, ADR-0058): builds and workers fail loudly when they would
 * run an open fallback instead. `TURBINEH_ALLOW_OPEN_ORCHESTRATION=1` is the deliberate escape hatch.
 */
export function privateEnginesRequired(env: Record<string, string | undefined>): boolean {
  if (env.TURBINEH_ALLOW_OPEN_ORCHESTRATION === "1") return false;
  return env.TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION === "1" || env.VERCEL_ENV === "production";
}

/** Location of the private resource decision engine, relative to the repository root. */
export const PRIVATE_DECIDER_DIR = "private/resource-decider";
export const PRIVATE_DECIDER_ENTRY = `${PRIVATE_DECIDER_DIR}/src/index.ts`;

export const missingPrivateDecider = (): Error =>
  new Error(
    `The private resource decision engine is required here but ${PRIVATE_DECIDER_DIR} is missing. ` +
      "See docs/PRIVATE_ORCHESTRATION.md (infra/private/sync.sh installs it; set " +
      "TURBINEH_ALLOW_OPEN_ORCHESTRATION=1 only for a deliberate open run).",
  );
