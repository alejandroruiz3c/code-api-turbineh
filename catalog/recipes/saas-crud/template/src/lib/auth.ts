import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { pool } from "@/db/client";
import { env } from "@/env";
import { maySignUp } from "@/lib/staff";

/** Authentication and organizations: catalog component auth.session.better-auth (+ organization plugin). */
export const auth = betterAuth({
  database: pool,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  databaseHooks: {
    user: {
      create: {
        // Sign-up policy (src/lib/sign-up-policy.ts): "staff" apps accept only ADMIN_EMAILS (deny by default).
        before: async (user) => {
          if (!maySignUp(user.email)) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is reserved for staff. Ask the owner to add your email.",
            });
          }
          return { data: user };
        },
      },
    },
    session: {
      create: {
        // A fresh sign-in resumes the user's first workspace (otherwise returning users land on "create workspace").
        before: async (session, ctx) => {
          if (session.activeOrganizationId || !ctx) return { data: session };
          const [first] = await ctx.context.adapter.findMany<{ organizationId: string }>({
            model: "member",
            where: [{ field: "userId", value: session.userId }],
            sortBy: { field: "createdAt", direction: "asc" },
            limit: 1,
          });
          return { data: { ...session, activeOrganizationId: first?.organizationId ?? null } };
        },
      },
    },
  },
  plugins: [organization(), nextCookies()],
});
