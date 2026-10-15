// Which orchestration engine the web app bundles (ADR-0053, ADR-0057). The proprietary agent orchestrator is a private
// repository checked out at <repo>/private/agent-orchestrator by infra/private/sync.sh, at the release pinned in
// infra/private/versions.json (never in the public tree). When present, the bundler and the tests alias
// "@turbineh/orchestration/engine" to it; otherwise the public open fallback is used. Production builds (Vercel
// production, or TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION=1) refuse to build without it.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ENGINE_SPECIFIER = "@turbineh/orchestration/engine";
/** Relative to apps/web (Turbopack aliases take project-relative paths). */
export const PRIVATE_ENGINE_RELATIVE = "../../private/agent-orchestrator/src/index.ts";
export const PRIVATE_ENGINE = fileURLToPath(new URL(PRIVATE_ENGINE_RELATIVE, import.meta.url));
export const hasPrivateEngine = () => existsSync(PRIVATE_ENGINE);

export function privateEngineRequired(env = process.env) {
  if (env.TURBINEH_ALLOW_OPEN_ORCHESTRATION === "1") return false;
  return env.TURBINEH_REQUIRE_PRIVATE_ORCHESTRATION === "1" || env.VERCEL_ENV === "production";
}

/** Throws when a production build would ship the open fallback instead of the private engine. */
export function assertEngine(env = process.env) {
  if (privateEngineRequired(env) && !hasPrivateEngine())
    throw new Error(
      "Production build without the private orchestration engine: private/agent-orchestrator is missing. " +
        "Run infra/private/sync.sh (docs/PRIVATE_ORCHESTRATION.md); set TURBINEH_ALLOW_OPEN_ORCHESTRATION=1 only for " +
        "a deliberate open build.",
    );
}
