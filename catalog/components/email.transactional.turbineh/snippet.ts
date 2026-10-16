// Server code in the app (e.g. src/app/dashboard/invoices/actions.ts).
import { sendEmail } from "@/lib/email";

export async function notifyInvoiceSent(to: string, invoiceUrl: string): Promise<boolean> {
  // Resend when RESEND_API_KEY is set; otherwise nothing is sent (development writes a local outbox file).
  const r = await sendEmail({
    to,
    subject: "Your invoice is ready",
    text: `Open your invoice: ${invoiceUrl}`,
    link: invoiceUrl,
  });
  return r.delivered;
}
