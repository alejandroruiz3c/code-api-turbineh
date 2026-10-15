"use server";
import { z } from "zod";
import { publicAction } from "@/server/authz";
import { waitlistConfig as cfg } from "@/waitlist/config";
import { confirm, join } from "@/waitlist/service";

/**
 * Public waitlist actions (component growth.waitlist.turbineh): join (with an optional referral code) and confirm the
 * emailed link. Both are publicAction(): per-IP rate limit and Zod validation before anything runs.
 */
export type JoinState = { ok: boolean; message: string } | null;
export type ConfirmState = { ok: boolean; message: string } | null;

const joinSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(320),
  ref: z.union([z.string().regex(/^[\w-]{4,16}$/), z.literal("")]).optional(),
  website: z.string().max(0).optional(), // honeypot: humans leave it empty
});

export const joinWaitlist = publicAction(
  "waitlist",
  {
    rateLimit: { limit: 10 },
    schema: joinSchema,
    refuse: (reason): JoinState => ({
      ok: false,
      message:
        reason === "rate-limited"
          ? "Too many attempts. Try again in a minute."
          : "Please enter your name and a valid email.",
    }),
  },
  async ({ name, email, ref }): Promise<JoinState> => {
    await join({ name, email, ref: ref || null });
    // Same answer for new and known emails: no enumeration of who is on the list.
    return {
      ok: true,
      message: cfg.doubleOptIn
        ? "You're on the list! Check your inbox and confirm your email to keep your place."
        : "You're on the list! Check your inbox for your position and referral link.",
    };
  },
);

export const confirmSignup = publicAction(
  "waitlist-confirm",
  {
    rateLimit: { limit: 20 },
    schema: z.object({ token: z.string().regex(/^[\w-]{20,64}$/) }),
    refuse: (reason): ConfirmState => ({
      ok: false,
      message:
        reason === "rate-limited" ? "Too many attempts. Try again in a minute." : "Invalid link.",
    }),
  },
  async ({ token }): Promise<ConfirmState> => {
    const row = await confirm(token);
    return row
      ? { ok: true, message: "Your email is confirmed." }
      : { ok: false, message: "This link is not valid." };
  },
);
