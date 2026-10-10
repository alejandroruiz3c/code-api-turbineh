import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { env } from "./env";

/**
 * Sign-in with GitHub (ADR-0005). Minimal scopes at sign-in; `repo` is requested only when the user asks to push a
 * build to their own GitHub account.
 */
export const auth = betterAuth({
  database: db,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      scope: ["read:user", "user:email"],
    },
  },
  plugins: [nextCookies()],
});
