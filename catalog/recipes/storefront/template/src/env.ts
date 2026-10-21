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
  /** Comma-separated emails allowed to manage products and orders. Optional: empty = nobody (deny by default). */
  ADMIN_EMAILS: z.string().default(""),
  /** Stripe secret key (sk_test_… or sk_live_…). Without it the shop works as a catalog. */
  STRIPE_SECRET_KEY: z
    .string()
    .startsWith("sk_")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Signing secret of the Stripe webhook endpoint (whsec_…). */
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .startsWith("whsec_")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /**
   * Vercel Blob read-write token (vercel_blob_rw_…): uploaded product images go to Vercel Blob. Empty = images are
   * stored in PostgreSQL and served by /shop/images/<id> (local development, the sandbox, hosts without Blob).
   */
  BLOB_READ_WRITE_TOKEN: z
    .string()
    .startsWith("vercel_blob_rw_")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Stripe API address (the real one by default; the verification sandbox points it to Stripe's simulator). */
  STRIPE_API_BASE: z.url().default("https://api.stripe.com"),
  /** ISO currency for all prices (lowercase, e.g. eur). */
  SHOP_CURRENCY: z
    .string()
    .regex(/^[a-z]{3}$/)
    .default("eur"),
  /**
   * Extra currencies the buyer can choose (comma-separated ISO codes, e.g. "usd,gbp"). Each one needs explicit
   * prices set by the admin: there are no exchange rates. Empty = only SHOP_CURRENCY.
   */
  SHOP_CURRENCIES: z
    .string()
    .regex(/^\s*([a-zA-Z]{3}\s*(,\s*[a-zA-Z]{3}\s*)*)?$/, "Use ISO codes separated by commas")
    .default(""),
  /** manual: the shop's own tax rates by country; stripe: Stripe Tax computes tax at checkout. */
  SHOP_TAX_MODE: z.enum(["manual", "stripe"]).default("manual"),
  /** true: product prices include tax (tax shown as contained); false: tax is added on top at checkout. */
  SHOP_PRICES_INCLUDE_TAX: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
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
