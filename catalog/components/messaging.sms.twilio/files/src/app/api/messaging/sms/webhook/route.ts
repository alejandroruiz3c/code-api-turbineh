import { smsSettings } from "@/messaging/sms/config";
import { handleTwilioWebhook } from "@/messaging/sms/service";
import { verifyTwilioSignature } from "@/messaging/sms/twilio";

/**
 * POST /api/messaging/sms/webhook — Twilio's signed webhook (component messaging.sms.twilio): replies to the app's
 * number (STOP opts the number out, START back in) and delivery status callbacks. Configure it as the number's
 * "A message comes in" URL; status callbacks are requested per message. Unsigned or wrongly signed calls get 403.
 */
const MAX_BODY = 64 * 1024;

export async function POST(req: Request): Promise<Response> {
  const s = smsSettings();
  if (!s.authToken || !s.appUrl)
    return Response.json({ error: "SMS webhook not configured" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "Too large" }, { status: 413 });
  const params = Object.fromEntries(new URLSearchParams(raw));
  // Twilio signs the public URL it called: this app's configured origin + path + query string.
  const url = `${s.appUrl}${new URL(req.url).pathname}${new URL(req.url).search}`;
  if (!verifyTwilioSignature(s.authToken, url, params, req.headers.get("x-twilio-signature")))
    return Response.json({ error: "Invalid signature" }, { status: 403 });
  if (s.accountSid && params.AccountSid && params.AccountSid !== s.accountSid)
    return Response.json({ error: "Unknown account" }, { status: 403 });
  await handleTwilioWebhook(params);
  // Empty TwiML: no automatic reply from the app (Twilio answers STOP/HELP itself with Advanced Opt-Out).
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { "content-type": "text/xml" },
  });
}
