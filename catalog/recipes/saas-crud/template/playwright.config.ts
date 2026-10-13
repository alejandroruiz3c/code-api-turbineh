import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3000);

// Offline, self-contained E2E: test-only settings are created here at runtime (never committed values). The
// workers inherit them from this process, so the app server and the tests agree.
process.env.ADMIN_EMAILS = [process.env.ADMIN_EMAILS, "admin-e2e@example.com"]
  .filter(Boolean)
  .join(",");
// Emails are logged (never sent) and recorded here, so tests can assert them.
process.env.EMAIL_OUTBOX_FILE ||= join(tmpdir(), `e2e-outbox-${process.pid}.jsonl`);

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
  webServer: {
    command: `pnpm start --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    timeout: 120_000,
    reuseExistingServer: false,
    // No real email provider in tests: emails go to the local outbox log.
    env: { ...process.env, RESEND_API_KEY: "" } as Record<string, string>,
  },
});
