import { z } from "zod";

/** Validated environment. The app refuses to start with missing or weak configuration. */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("App <onboarding@resend.dev>"),
  /** Comma-separated emails allowed to manage products and orders. */
  ADMIN_EMAILS: z.string().min(3),
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

export const env = schema.parse(process.env);
