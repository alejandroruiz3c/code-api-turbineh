"use server";
import { z } from "zod";
import { db } from "@/db/client";
import { waitlistEntries } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { publicAction } from "@/server/authz";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z
    .email()
    .max(320)
    .transform((v) => v.toLowerCase()),
  website: z.string().max(0).optional(), // honeypot: humans leave it empty
});

/** Waitlist sign-up: validated, rate-limited, stored once per email, with a confirmation email. */
export type JoinState = { ok: boolean; message: string } | null;

// Public by design (anyone can join): publicAction() rate-limits per IP and validates with Zod (+ honeypot).
export const joinWaitlist = publicAction(
  "waitlist",
  {
    rateLimit: { limit: 5 },
    schema,
    refuse: (reason): JoinState => ({
      ok: false,
      message:
        reason === "rate-limited"
          ? "Too many attempts. Try again in a minute."
          : "Please enter your name and a valid email.",
    }),
  },
  async ({ name, email }): Promise<JoinState> => {
    const inserted = await db
      .insert(waitlistEntries)
      .values({ name, email })
      .onConflictDoNothing({ target: waitlistEntries.email })
      .returning({ id: waitlistEntries.id });
    if (inserted.length > 0) {
      await sendEmail({
        to: email,
        subject: "You're on the waitlist",
        text: `Hi ${name}, thanks for joining the __APP_NAME__ waitlist. We'll be in touch.`,
      });
    }
    // Same answer for new and existing emails: no enumeration of who is on the list.
    return { ok: true, message: "You're on the list! Check your inbox." };
  },
);
