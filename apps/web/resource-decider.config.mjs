// Which resource decision engine the web app bundles (ADR-0058): plan decisions (which app of a monorepo) and the AI
// gateway's hedging policy. TurbineH's engine lives in a private package at <repo>/private/resource-decider (its own
// repository, never in the public tree); when present, "@turbineh/decider/engine" is aliased to it, otherwise to the
// public open fallback. Production builds (Vercel production, or TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION=1) refuse to
// build without it. The web never loads the Node loader of @turbineh/decider/engine (dynamic import by path).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DECIDER_ENGINE_SPECIFIER = "@turbineh/decider/engine";
/** Relative to apps/web (Turbopack aliases take project-relative paths). */
export const PRIVATE_DECIDER_RELATIVE = "../../private/resource-decider/src/index.ts";
/** The built open fallback (packages are built before the web app). */
export const OPEN_DECIDER_RELATIVE = "../../packages/decider/dist/open-engine.js";
export const PRIVATE_DECIDER = fileURLToPath(new URL(PRIVATE_DECIDER_RELATIVE, import.meta.url));
export const OPEN_DECIDER = fileURLToPath(new URL(OPEN_DECIDER_RELATIVE, import.meta.url));
export const hasPrivateDecider = () => existsSync(PRIVATE_DECIDER);

/** The alias target: project-relative for Turbopack, absolute for Vitest. */
export const deciderEngineTarget = ({ absolute = false } = {}) =>
  hasPrivateDecider()
    ? absolute
      ? PRIVATE_DECIDER
      : PRIVATE_DECIDER_RELATIVE
    : absolute
      ? OPEN_DECIDER
      : OPEN_DECIDER_RELATIVE;

export function privateDeciderRequired(env = process.env) {
  if (env.TURBINEH_ALLOW_OPEN_ORCHESTRATION === "1") return false;
  return env.TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION === "1" || env.VERCEL_ENV === "production";
}

/** Throws when a production build would ship the open fallback instead of the private decision engine. */
export function assertDeciderEngine(env = process.env) {
  if (privateDeciderRequired(env) && !hasPrivateDecider())
    throw new Error(
      "Production build without the private resource decision engine: private/resource-decider is missing. " +
        "See docs/PRIVATE_ORCHESTRATION.md (infra/private/sync.sh installs it; set " +
        "TURBINEH_ALLOW_OPEN_ORCHESTRATION=1 only for a deliberate open build).",
    );
}
