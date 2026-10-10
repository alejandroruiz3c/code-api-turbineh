import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { pool } from "@/db/client";
import { env } from "@/env";

/** Authentication and organizations: catalog component auth.session.better-auth (+ organization plugin). */
export const auth = betterAuth({
  database: pool,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  plugins: [organization(), nextCookies()],
});
