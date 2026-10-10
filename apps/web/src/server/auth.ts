import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getPool } from "@turbineh/db";
import { env } from "./env";

/**
 * Sign-in with GitHub (ADR-0005). Minimal scopes at sign-in; `repo` is requested only when the user asks to push a
 * build to their own GitHub account.
 */
function createAuth() {
  return betterAuth({
    database: getPool(env.DATABASE_URL),
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
}

let instance: ReturnType<typeof createAuth> | undefined;
export const getAuth = () => (instance ??= createAuth());

/** Lazy proxy: the auth instance (and env validation) is created on first request, not at import/build time. */
export const auth = new Proxy({} as ReturnType<typeof createAuth>, {
  get: (_t, key: string) => Reflect.get(getAuth(), key) as unknown,
});
