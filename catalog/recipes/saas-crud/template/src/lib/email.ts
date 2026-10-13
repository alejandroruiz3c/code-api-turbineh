import { appendFileSync } from "node:fs";
import { env } from "@/env";

/**
 * Transactional email (component email.transactional.turbineh): Resend HTTP API when RESEND_API_KEY is set,
 * otherwise a local outbox log (development and sandboxed tests). Never logs message bodies; an action link (e.g. email
 * verification) is logged in log mode, because without a provider the log is the only way to deliver it.
 */
export async function sendEmail(msg: {
  to: string;
  subject: string;
  text: string;
  /** Action link the recipient must open (verification, reset). */
  link?: string;
}): Promise<{ transport: "resend" | "log"; delivered: boolean }> {
  if (!env.RESEND_API_KEY) {
    const entry = JSON.stringify({
      to: msg.to,
      subject: msg.subject,
      ...(msg.link ? { link: msg.link } : {}),
    });
    console.info("[email:outbox]", entry);
    // Test runs (playwright.config.ts) also record the outbox in a file so E2E tests can assert emails.
    const outbox = process.env.EMAIL_OUTBOX_FILE;
    if (outbox) appendFileSync(outbox, `${entry}\n`);
    return { transport: "log", delivered: false };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
    }),
  });
  return { transport: "resend", delivered: res.ok };
}
