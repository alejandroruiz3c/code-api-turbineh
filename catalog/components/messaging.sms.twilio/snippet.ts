// Server code in the app (a server action or a route): record the consent a person gave on a form, then send them an
// SMS. sendSms sends nothing to numbers without consent or that replied STOP, and only logs without Twilio credentials.
import { recordSmsConsent, sendSms } from "@/messaging/sms/service";

export async function textOrderReady(phone: string, orderRef: string, agreed: boolean) {
  if (agreed) await recordSmsConsent(phone, `order-form:${orderRef}`);
  return sendSms({
    to: phone,
    body: `Your order ${orderRef} is ready for pickup. Reply STOP to opt out.`,
    purpose: "order-ready",
    reference: orderRef,
  });
}
