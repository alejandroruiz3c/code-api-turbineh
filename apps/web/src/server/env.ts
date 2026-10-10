import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  /** 32-byte key (base64) used to encrypt user GitHub tokens while a delivery is pending. */
  DELIVERY_TOKEN_KEY: z.string().min(40),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  DAILY_COST_CAP_EUR: z.coerce.number().default(100),
  USER_DAILY_BUILDS: z.coerce.number().int().default(10),
});

export const env = schema.parse(process.env);
