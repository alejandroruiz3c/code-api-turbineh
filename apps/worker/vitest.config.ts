import { defineConfig } from "vitest/config";

export default defineConfig({
  // fixtures/ holds client projects used by the integration tests (they run in the sandbox, not here).
  test: { include: ["src/**/*.test.ts"] },
});
