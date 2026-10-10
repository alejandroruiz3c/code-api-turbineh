"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db/client";
import { waitlistEntries } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { rateLimit } from "@/security/rate-limit";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z
    .email()
    .max(320)
    .transform((v) => v.toLowerCase()),
  website: z.string().max(0).optional(), // honeypot: humans leave it empty
});

export type JoinState = { ok: boolean; message: string } | null;

export async function joinWaitlist(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "local").split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`waitlist:${ip}`, 5))
    return { ok: false, message: "Too many attempts. Try again in a minute." };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Please enter your name and a valid email." };
  const inserted = await db
    .insert(waitlistEntries)
    .values({ name: parsed.data.name, email: parsed.data.email })
    .onConflictDoNothing({ target: waitlistEntries.email })
    .returning({ id: waitlistEntries.id });
  if (inserted.length > 0) {
    await sendEmail({
      to: parsed.data.email,
      subject: "You're on the waitlist",
      text: `Hi ${parsed.data.name}, thanks for joining the __APP_NAME__ waitlist. We'll be in touch.`,
    });
  }
  // Same answer for new and existing emails: no enumeration of who is on the list.
  return { ok: true, message: "You're on the list! Check your inbox." };
}
