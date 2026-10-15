import { simpleParser } from "mailparser";

const MAX_EMAIL_BYTES = 25 * 1024 * 1024;

/** Parsed raw email: sender, subject, text and attachment metadata. Attachments are untrusted input. */
export async function parseEmail(raw: Buffer | string): Promise<{
  from: string | null;
  subject: string;
  text: string;
  attachments: { filename: string | null; contentType: string; size: number }[];
}> {
  const size = typeof raw === "string" ? Buffer.byteLength(raw) : raw.byteLength;
  if (size > MAX_EMAIL_BYTES) throw new Error("Email is too large");
  const mail = await simpleParser(raw);
  return {
    from: mail.from?.value[0]?.address ?? null,
    subject: mail.subject ?? "",
    text: (mail.text ?? "").trim(),
    attachments: mail.attachments.map((a) => ({
      filename: a.filename ?? null,
      contentType: a.contentType,
      size: a.size,
    })),
  };
}
