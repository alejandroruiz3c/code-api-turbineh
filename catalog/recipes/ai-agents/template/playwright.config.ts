import { defineConfig, devices } from "@playwright/test";
import { mockLlmEnv, mockLlmWebServer } from "./tests/mock-llm/playwright";

const port = Number(process.env.PORT ?? 3000);

/** Staff allow-list used by the E2E tests (the verification sandbox sets ADMIN_EMAILS). */
const E2E_ADMIN_EMAIL = (process.env.ADMIN_EMAILS ?? "admin-e2e@example.com").split(",")[0]!.trim();

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    // Signs up one owner and stores the session, so feature tests do not hit the auth rate limiter.
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/owner.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    // Scripted OpenAI-compatible model (tests/mock-llm): no test ever reaches the internet.
    mockLlmWebServer,
    {
      command: `pnpm start --port ${port}`,
      url: `http://127.0.0.1:${port}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...mockLlmEnv,
        ADMIN_EMAILS: process.env.ADMIN_EMAILS ?? E2E_ADMIN_EMAIL,
        // One browser IP runs the whole suite.
        AI_PUBLIC_REQUESTS_PER_MINUTE: "200",
      },
    },
  ],
});
