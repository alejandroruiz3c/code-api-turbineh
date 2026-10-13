import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { pool } from "@/db/client";
import { env } from "@/env";
import { sendEmail } from "@/lib/email";
import { maySignUp } from "@/lib/staff";

/** Authentication and organizations: catalog component auth.session.better-auth (+ organization plugin). */
export const auth = betterAuth({
  database: pool,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  // Staff rights depend on the email address, so it must be proven: a verification link is sent on sign-up and staff
  // access (src/lib/staff.ts) is granted only once session.user.emailVerified is true.
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your email address",
        text: `Open this link to verify your email address:\n\n${url}\n\nIf you did not create an account, ignore this email.`,
        link: url,
      });
    },
  },
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
