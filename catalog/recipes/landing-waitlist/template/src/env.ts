import { z } from "zod";

/** Validated environment. The app refuses to start with missing or weak configuration. */
const settings = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("App <onboarding@resend.dev>"),
  /**
   * Without RESEND_API_KEY in production the app refuses to start, unless EMAIL_DELIVERY=disabled says on purpose
   * that it runs without email (nothing is sent; links are never logged). See src/lib/email.ts.
   */
  EMAIL_DELIVERY: z.enum(["provider", "disabled"]).optional(),
  /** Local outbox file for emails when there is no provider (tests and development); never the console. */
  EMAIL_OUTBOX_FILE: z.string().optional(),
  /** Proxies in front of the app whose X-Forwarded-For is trusted (0 = none; Vercel: 1). See src/security/client-ip.ts. */
  TRUSTED_PROXY_HOPS: z
    .string()
    .regex(/^[0-5]?$/, "TRUSTED_PROXY_HOPS must be 0 to 5")
    .optional(),
  /** Comma-separated emails allowed to read the waitlist. Optional: empty = nobody (deny by default). */
  ADMIN_EMAILS: z.string().default(""),
});

/** Cross-setting rules, checked when the app starts (src/instrumentation.ts). */
const schema = settings.superRefine((e, ctx) => {
  // In production an email provider is required (verification links must reach people, never a log), unless the
  // deployment says it runs without email, or a test run records emails in its outbox file (playwright.config.ts).
  if (
    e.NODE_ENV === "production" &&
    !building &&
    !e.RESEND_API_KEY &&
    !e.EMAIL_OUTBOX_FILE &&
    e.EMAIL_DELIVERY !== "disabled"
  )
    ctx.addIssue({
      code: "custom",
      path: ["RESEND_API_KEY"],
      message:
        "RESEND_API_KEY is required in production (verification and invitation emails must be delivered, never logged). Set it, or set EMAIL_DELIVERY=disabled to run without email on purpose.",
    });
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
