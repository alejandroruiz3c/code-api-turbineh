import { z } from "zod";

/** Validated environment. The app refuses to start with missing or weak configuration. */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("App <onboarding@resend.dev>"),
  /** Comma-separated emails allowed to read the waitlist. Optional: empty = nobody (deny by default). */
  ADMIN_EMAILS: z.string().default(""),
});

/**
 * `next build` imports server modules without the runtime settings (a deploy or a coding agent builds without
 * .env.local). For that one process only, a required setting that is missing gets a throwaway value generated here:
 * never a literal in code, never at runtime, where `next start` validates the real values. Required settings have no
 * .default(); tests generate their own secrets at runtime (playwright.config.ts); real values live in .env.local.
 */
const building = process.env.NEXT_PHASE === "phase-production-build";
const buildOnly: Record<string, string> = building
  ? {
      DATABASE_URL: "postgres://build@127.0.0.1:1/build",
      BETTER_AUTH_SECRET: `${crypto.randomUUID()}${crypto.randomUUID()}`,
      BETTER_AUTH_URL: "http://localhost:3000",
    }
  : {};

export const env = schema.parse({ ...buildOnly, ...process.env });
