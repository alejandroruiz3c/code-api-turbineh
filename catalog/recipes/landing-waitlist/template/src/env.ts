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

export const env = schema.parse(process.env);
