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
  /** ISO currency for all prices (lowercase, e.g. eur). */
  SHOP_CURRENCY: z
    .string()
    .regex(/^[a-z]{3}$/)
    .default("eur"),
});

export const env = schema.parse(process.env);
