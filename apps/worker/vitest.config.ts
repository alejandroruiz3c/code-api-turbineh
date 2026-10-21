import { defineConfig } from "vitest/config";

export default defineConfig({
  // fixtures/ holds client projects used by the integration tests (they run in the sandbox, not here).
  // Gate tests read the whole catalogue on their first call: on a busy CI runner that cold start alone can pass 5 s.
  test: { include: ["src/**/*.test.ts"], testTimeout: 30_000 },
});
