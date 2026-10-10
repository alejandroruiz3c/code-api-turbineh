import { env } from "@/env";

/**
 * Transactional email (component email.transactional.turbineh): Resend HTTP API when RESEND_API_KEY is set,
 * otherwise a local outbox log (development and sandboxed tests). Never logs message bodies.
 */
export async function sendEmail(msg: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ transport: "resend" | "log"; delivered: boolean }> {
  if (!env.RESEND_API_KEY) {
    console.info("[email:outbox]", JSON.stringify({ to: msg.to, subject: msg.subject }));
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
