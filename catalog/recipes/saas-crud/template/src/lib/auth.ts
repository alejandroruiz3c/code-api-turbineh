import { betterAuth, getCurrentAdapter } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { pool } from "@/db/client";
import { env } from "@/env";
import { sendEmail } from "@/lib/email";
import { SIGN_UP_POLICY } from "@/lib/sign-up-policy";
import { maySignUp } from "@/lib/staff";
import { SIGN_UP_EMAIL_DOMAINS } from "@/server/permissions";

/**
 * Sign-in/sign-up attempts per client per 10 s (better-auth's default is 3). AUTH_RATE_LIMIT_MAX raises it for a
 * deployment that needs more (the E2E run sets it, as several people sign up from one address in seconds); bounded.
 */
const authAttemptsMax = Math.min(
  Math.max(Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? "", 10) || 3, 1),
  1000,
);

/** Authentication and organizations: catalog component auth.session.better-auth (+ organization plugin). */
export const auth = betterAuth({
  database: pool,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  rateLimit: {
    customRules: {
      "/sign-in/*": { window: 10, max: authAttemptsMax },
      "/sign-up/*": { window: 10, max: authAttemptsMax },
    },
  },
  // `pnpm db:migrate` is what creates these tables: no "schema mismatch" warning while it runs.
  advanced: { database: { validateSchema: process.env.TURBINEH_DB_MIGRATE !== "1" } },
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
              message:
                SIGN_UP_POLICY === "open" && SIGN_UP_EMAIL_DOMAINS.length > 0
                  ? `Sign-up is limited to ${SIGN_UP_EMAIL_DOMAINS.map((d) => `@${d}`).join(", ")} emails.`
                  : "Sign-up is reserved for staff. Ask the owner to add your email.",
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
          // The adapter of the surrounding transaction (sign-up runs in one), never a second connection that waits.
          const adapter = await getCurrentAdapter(ctx.context.adapter);
          const [first] = await adapter.findMany<{ organizationId: string }>({
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
