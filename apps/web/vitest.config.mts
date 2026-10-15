import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { ENGINE_SPECIFIER, hasPrivateEngine, PRIVATE_ENGINE } from "./orchestration.config.mjs";

// Same "@/…" alias as tsconfig.json, so component tests can render components that import from "@/lib/…".
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The private orchestration engine when installed (ADR-0053), else the public open fallback.
      ...(hasPrivateEngine() ? { [ENGINE_SPECIFIER]: PRIVATE_ENGINE } : {}),
    },
  },
});
