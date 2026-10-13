"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db/client";
import { contactMessages } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { staffEmails } from "@/lib/staff";
import { rateLimit } from "@/security/rate-limit";

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

// Public by design (anyone can write to the company): IP rate limit, honeypot and Zod; no member to check.
// nosemgrep: turbineh.server-action-without-authz
export async function sendContact(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "local").split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`contact:${ip}`, 5))
    return { ok: false, message: "Too many messages. Try again in a minute." };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      ok: false,
      message: "Please fill in your name, a valid email and a message (10+ characters).",
    };
  if (parsed.data.website) return { ok: true, message: "Thanks! We will get back to you soon." };
  const { name, email, company, message } = parsed.data;
  await db.insert(contactMessages).values({ name, email, company: company || null, message });
  for (const to of staffEmails()) {
    await sendEmail({
      to,
      subject: `New message from ${name}`,
      text: `${name} <${email}>${company ? ` (${company})` : ""}\n\n${message}`,
    });
  }
  return { ok: true, message: "Thanks! We will get back to you soon." };
}
