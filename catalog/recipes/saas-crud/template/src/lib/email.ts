import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "@/env";

/**
 * Transactional email (component email.transactional.turbineh): the Resend HTTP API when RESEND_API_KEY is set.
 * Without it nothing is sent (ADR-0054): production refuses to start unless EMAIL_DELIVERY=disabled (src/env.ts);
 * development and test runs record each email in a local outbox file (EMAIL_OUTBOX_FILE; in development
 * `.turbineh/email-outbox.jsonl` by default), which is how E2E tests read links. Action links and bodies are never
 * written to the console or server logs: anyone with log access could use them.
 */
export async function sendEmail(msg: {
  to: string;
  subject: string;
  text: string;
  /** Action link the recipient must open (verification, reset). */
  link?: string;
}): Promise<{ transport: "resend" | "log"; delivered: boolean }> {
  if (!env.RESEND_API_KEY) {
    const outbox =
      env.EMAIL_OUTBOX_FILE ??
      (env.NODE_ENV === "development" ? ".turbineh/email-outbox.jsonl" : undefined);
    if (outbox && env.EMAIL_DELIVERY !== "disabled") {
      mkdirSync(dirname(outbox), { recursive: true });
      appendFileSync(
        outbox,
        `${JSON.stringify({ to: msg.to, subject: msg.subject, ...(msg.link ? { link: msg.link } : {}), text: msg.text })}\n`,
      );
    }
    // The log says that an email was not sent, never what it says or which link it carries.
    console.info(
      "[email:not-sent]",
      JSON.stringify({
        subject: msg.subject,
        outbox: outbox && env.EMAIL_DELIVERY !== "disabled" ? outbox : null,
      }),
    );
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
