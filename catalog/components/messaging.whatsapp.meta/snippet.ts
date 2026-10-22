// Server code in the app: record the opt-in a person gave on a form, then send them an approved template (created in
// WhatsApp Manager with two body parameters). Nothing is sent without opt-in or after STOP; logged without credentials.
import { recordWhatsAppConsent, sendWhatsAppTemplate } from "@/messaging/whatsapp/service";

export async function whatsappOrderReady(
  phone: string,
  name: string,
  orderRef: string,
  optedIn: boolean,
) {
  if (optedIn) await recordWhatsAppConsent(phone, `order-form:${orderRef}`);
  return sendWhatsAppTemplate({
    to: phone,
    template: { name: "order_ready", language: "en", bodyParams: [name, orderRef] },
    purpose: "order-ready",
    reference: orderRef,
  });
}
