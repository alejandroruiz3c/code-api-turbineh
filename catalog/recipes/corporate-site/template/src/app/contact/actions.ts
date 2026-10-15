"use server";
import { z } from "zod";
import { db } from "@/db/client";
import { contactMessages } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { staffEmails } from "@/lib/staff";
import { publicAction } from "@/server/authz";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z
    .email()
    .max(320)
    .transform((v) => v.toLowerCase()),
  company: z.string().trim().max(160).optional(),
  message: z.string().trim().min(10).max(5000),
  website: z.string().max(0).optional(), // honeypot: humans leave it empty
});

/** Contact form: validated, rate-limited, stored and emailed to staff (ADMIN_EMAILS). */
export type ContactState = { ok: boolean; message: string } | null;

// Public by design (anyone can write to the company): publicAction() rate-limits per IP and validates with Zod
// (+ honeypot); there is no member to check.
export const sendContact = publicAction(
  "contact",
  {
    rateLimit: { limit: 5 },
    schema,
    refuse: (reason): ContactState => ({
      ok: false,
      message:
        reason === "rate-limited"
          ? "Too many messages. Try again in a minute."
          : "Please fill in your name, a valid email and a message (10+ characters).",
    }),
  },
  async ({ name, email, company, message }): Promise<ContactState> => {
    await db.insert(contactMessages).values({ name, email, company: company || null, message });
    for (const to of staffEmails()) {
      await sendEmail({
        to,
        subject: `New message from ${name}`,
        text: `${name} <${email}>${company ? ` (${company})` : ""}\n\n${message}`,
      });
    }
    return { ok: true, message: "Thanks! We will get back to you soon." };
  },
);
