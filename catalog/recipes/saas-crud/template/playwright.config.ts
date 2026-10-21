import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { TEST_ENV } from "./tests/e2e/test-env";

/*
 * The E2E run owns its URLs: a free port picked once (workers inherit it through E2E_PORT) and the app's origin on
 * it. Ambient PORT, BETTER_AUTH_URL or APP_URL (a dev server, a shell profile, .env.local) are ignored, so auth origin
 * checks and redirects always match the server Playwright starts.
 */
process.env.E2E_PORT ||= execFileSync(
  process.execPath,
  [
    "-e",
    "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})",
  ],
  { encoding: "utf8" },
);
const port = Number(process.env.E2E_PORT);
const origin = `http://127.0.0.1:${port}`;
process.env.BETTER_AUTH_URL = origin;
process.env.APP_URL = origin;
process.env.PORT = String(port);
if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL is not set: run `pnpm test:e2e` (it starts a fresh local PostgreSQL, see scripts/local-db.ts).",
  );

/*
 * Offline, self-contained E2E (no internet, no real keys). Every external service the app calls has a local mock in
 * tests/e2e/mocks/<ENV_VAR>.mjs: it is started here and <ENV_VAR> (the service's base URL) points to it. Test-only
 * secrets are generated at runtime (never committed); the workers inherit them from this process.
 */
const mocksDir = "tests/e2e/mocks";
const mocks = existsSync(mocksDir)
  ? readdirSync(mocksDir)
      .filter((f) => /^[A-Z][A-Z0-9_]*\.(mjs|ts)$/.test(f))
      .sort()
  : [];
const mockServers = mocks.map((file, i) => {
  const mockPort = 12100 + i;
  process.env[file.replace(/\.(mjs|ts)$/, "")] = `http://127.0.0.1:${mockPort}`;
  return {
    command: file.endsWith(".ts")
      ? `pnpm exec tsx ${mocksDir}/${file}`
      : `node ${mocksDir}/${file}`,
    url: `http://127.0.0.1:${mockPort}/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: { PORT: String(mockPort), MOCK_PORT: String(mockPort) },
  };
});
const built = existsSync(".next/BUILD_ID");
const secret = (prefix = "") => `${prefix}${randomBytes(24).toString("hex")}`;
process.env.BETTER_AUTH_SECRET ||= secret();
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
  // The same mock answers OpenAI-compatible calls (AI_BASE_URL) for agents that use them.
  process.env.AI_BASE_URL = `${process.env.TURBINEH_AI_URL}/v1`;
  process.env.AI_API_KEY ||= secret();
  process.env.AI_MODEL ||= "mock-model";
}
if (process.env.S3_BASE_URL?.startsWith("http://127.0.0.1")) {
  // Private-bucket mock (storage.private-uploads.turbineh): the app uses its S3 driver with throwaway credentials,
  // and the mock checks every request's SigV4 signature with them.
  process.env.STORAGE_DRIVER = "s3";
  process.env.S3_BUCKET ||= "e2e-private";
  process.env.S3_REGION ||= "us-east-1";
  process.env.S3_ACCESS_KEY_ID ||= secret("e2e");
  process.env.S3_SECRET_ACCESS_KEY ||= secret();
}
// Social networks (social.*.turbineh): the LinkedIn, Meta Graph and X mocks serve both the consent pages and the
// APIs; the app gets throwaway app credentials and a throwaway token-encryption key (the mocks read the same ones).
const socialMocks: [api: string, auth: string, id: string, secretName: string][] = [
  ["LINKEDIN_API_BASE", "LINKEDIN_AUTH_BASE_URL", "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  ["META_GRAPH_API_BASE", "META_AUTH_BASE_URL", "META_APP_ID", "META_APP_SECRET"],
  ["X_API_BASE", "X_AUTH_BASE_URL", "X_CLIENT_ID", "X_CLIENT_SECRET"],
];
for (const [api, auth, id, secretName] of socialMocks) {
  if (!process.env[api]?.startsWith("http://127.0.0.1")) continue;
  process.env[auth] = process.env[api];
  process.env[id] = `e2e-${id.toLowerCase().replace(/_/g, "-")}`;
  process.env[secretName] = secret();
  process.env.SOCIAL_TOKEN_KEY ||= randomBytes(32).toString("base64");
}
// Messaging (messaging.sms.twilio, messaging.whatsapp.meta): the Twilio and WhatsApp Cloud API mocks check credentials
// generated here (kept by the workers, which read them to sign webhook calls); the WhatsApp mock posts its status
// webhooks to the app.
if (process.env.TWILIO_API_BASE?.startsWith("http://127.0.0.1")) {
  process.env.TWILIO_ACCOUNT_SID ||= `AC${randomBytes(16).toString("hex")}`;
  process.env.TWILIO_AUTH_TOKEN ||= secret();
  // Twilio's documented test "From" number.
  process.env.TWILIO_FROM_NUMBER ||= "+15005550006";
}
if (process.env.WHATSAPP_API_BASE?.startsWith("http://127.0.0.1")) {
  process.env.WHATSAPP_ACCESS_TOKEN ||= secret();
  process.env.WHATSAPP_PHONE_NUMBER_ID ||= String(100_000_000_000 + randomBytes(4).readUInt32BE());
  process.env.WHATSAPP_APP_SECRET ||= secret();
  process.env.WHATSAPP_VERIFY_TOKEN ||= secret();
  process.env.WHATSAPP_MOCK_WEBHOOK_URL = `${origin}/api/messaging/whatsapp/webhook`;
}
// Several people sign up from one address within seconds: raise better-auth's 3-per-10 s sign-in/sign-up limit for
// the run instead of waiting for its window (src/lib/auth.ts).
process.env.AUTH_RATE_LIMIT_MAX ||= "1000";
// Scheduled jobs (jobs.scheduled.turbineh): the cron route's shared secret, generated per run.
process.env.CRON_SECRET ||= secret();
// Recipe-specific test settings (tests/e2e/test-env.ts), e.g. a second shop currency.
for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] ||= v;

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: ["mocks/**"],
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: { baseURL: origin, trace: "retain-on-failure" },
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
      // Builds first when there is no production build yet (zero setup); re-run `pnpm build` after code changes.
      command: `${built ? "" : "pnpm build && "}pnpm start --port ${port}`,
      url: origin,
      timeout: built ? 120_000 : 600_000,
      reuseExistingServer: false,
      // No real email provider in tests: emails go to the local outbox log.
      env: { ...process.env, RESEND_API_KEY: "" } as Record<string, string>,
    },
  ],
});
