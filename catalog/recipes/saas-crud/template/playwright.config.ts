import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { TEST_ENV } from "./tests/e2e/test-env";

const port = Number(process.env.PORT ?? 3000);

/*
 * Offline, self-contained E2E (no internet, no real keys). Every external service the app calls has a local mock in
 * tests/e2e/mocks/<ENV_VAR>.mjs: it is started here and <ENV_VAR> (the service's base URL) points to it. Test-only
 * secrets are generated at runtime (never committed); the workers inherit them from this process.
 */
const mocksDir = "tests/e2e/mocks";
const mocks = existsSync(mocksDir)
  ? readdirSync(mocksDir)
      .filter((f) => /^[A-Z][A-Z0-9_]*\.mjs$/.test(f))
      .sort()
  : [];
const mockServers = mocks.map((file, i) => {
  const mockPort = 12100 + i;
  process.env[file.replace(/\.mjs$/, "")] = `http://127.0.0.1:${mockPort}`;
  return {
    command: `node ${mocksDir}/${file}`,
    url: `http://127.0.0.1:${mockPort}/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: { PORT: String(mockPort), MOCK_PORT: String(mockPort) },
  };
});
const secret = (prefix = "") => `${prefix}${randomBytes(24).toString("hex")}`;
process.env.BETTER_AUTH_SECRET ||= secret();
process.env.BETTER_AUTH_URL ||= `http://127.0.0.1:${port}`;
// A second staff address, unique per run, to prove staff access needs a verified email.
process.env.E2E_STAFF_EMAIL ||= `staff-${Date.now()}@example.com`;
process.env.ADMIN_EMAILS = [
  process.env.ADMIN_EMAILS,
  "admin-e2e@example.com",
  process.env.E2E_STAFF_EMAIL,
]
  .filter(Boolean)
  .join(",");
// Emails are logged (never sent) and recorded here, so tests can assert them.
process.env.EMAIL_OUTBOX_FILE ||= join(tmpdir(), `e2e-outbox-${process.pid}.jsonl`);
if (process.env.STRIPE_API_BASE?.startsWith("http://127.0.0.1")) {
  // Stripe mock: test keys only, never a live key.
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))
    process.env.STRIPE_SECRET_KEY = secret("sk_test_");
  process.env.STRIPE_WEBHOOK_SECRET ||= secret("whsec_");
  process.env.STRIPE_PRICE_PRO ||= "price_e2e_pro";
}
if (process.env.TURBINEH_AI_URL?.startsWith("http://127.0.0.1")) {
  process.env.TURBINEH_AI_TOKEN ||= secret();
}
// Recipe-specific test settings (tests/e2e/test-env.ts), e.g. a second shop currency.
for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] ||= v;

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: ["mocks/**"],
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
    ...mockServers,
    {
      command: `pnpm start --port ${port}`,
      url: `http://127.0.0.1:${port}`,
      timeout: 120_000,
      reuseExistingServer: false,
      // No real email provider in tests: emails go to the local outbox log.
      env: { ...process.env, RESEND_API_KEY: "" } as Record<string, string>,
    },
  ],
});
