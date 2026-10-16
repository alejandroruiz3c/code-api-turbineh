import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  /** 32-byte key (base64) used to encrypt user GitHub tokens while a delivery is pending. */
  DELIVERY_TOKEN_KEY: z.string().min(40),
  /** Invitation access token for the product area and API (ADR-0030). Never in git: env only. */
  PRODUCT_ACCESS_TOKEN: z.string().min(12),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  DAILY_COST_CAP_EUR: z.coerce.number().default(100),
  USER_DAILY_BUILDS: z.coerce.number().int().default(10),
  /** Browser builds per client IP per day, across accounts (PLAN §9 viral capacity). */
  IP_DAILY_BUILDS: z.coerce.number().int().default(30),
  /** Internal operations access (cost and fleet data): GitHub account emails and API-key owners, comma-separated. */
  OPS_ADMIN_EMAILS: z.string().default(""),
  OPS_OWNER_IDS: z.string().default("ops:smoke"),
  /** "Connect Vercel" for Deploy for me (ADR-0021). Optional: without them the client pastes a token instead. */
  VERCEL_INTEGRATION_SLUG: z.string().optional(),
  VERCEL_INTEGRATION_CLIENT_ID: z.string().optional(),
  VERCEL_INTEGRATION_CLIENT_SECRET: z.string().optional(),
  /** Landing server secret for POST /v1/ai/trial-signups (ADR-0059). Optional: without it the endpoint is 404. */
  ORCHESTRATION_SIGNUP_SECRET: z.string().optional(),
  /** Vercel Cron's bearer secret for /v1/cron/* (ADR-0061). Optional: without it the cron routes are 404. */
  CRON_SECRET: z.string().optional(),
  /** Recipient of the owner usage report (ADR-0061); ORCHESTRATION_REPORT_EMAIL is accepted as an alias. */
  OWNER_REPORT_EMAIL: z.string().optional(),
  ORCHESTRATION_REPORT_EMAIL: z.string().optional(),
  /** "1" lets the weekly cron email from a non-production host (staging defaults to a dry run). */
  OWNER_REPORT_CRON_SEND: z.string().optional(),
});

type Env = z.infer<typeof schema>;
let cached: Env | undefined;

/** Validated lazily on first use (at request time), so builds never need runtime secrets. */
export const env = new Proxy({} as Env, {
  get: (_t, key: string) => (cached ??= schema.parse(process.env))[key as keyof Env],
});
