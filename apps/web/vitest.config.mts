import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { ENGINE_SPECIFIER, hasPrivateEngine, PRIVATE_ENGINE } from "./orchestration.config.mjs";
import { DECIDER_ENGINE_SPECIFIER, deciderEngineTarget } from "./resource-decider.config.mjs";

// Same "@/…" alias as tsconfig.json, so component tests can render components that import from "@/lib/…".
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The private orchestration engine when installed (ADR-0053), else the public open fallback.
      ...(hasPrivateEngine() ? { [ENGINE_SPECIFIER]: PRIVATE_ENGINE } : {}),
      // The private resource decision engine when installed (ADR-0056), else the open fallback.
      [DECIDER_ENGINE_SPECIFIER]: deciderEngineTarget({ absolute: true }),
    },
  },
});
