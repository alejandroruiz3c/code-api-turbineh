import { verifyMetaSignature } from "@/messaging/whatsapp/cloud-api";
import { whatsappSettings } from "@/messaging/whatsapp/config";
import { handleWhatsAppWebhook } from "@/messaging/whatsapp/service";

/**
 * GET|POST /api/messaging/whatsapp/webhook — the WhatsApp Business webhook (component messaging.whatsapp.meta). GET
 * answers Meta's verification request (hub.verify_token = WHATSAPP_VERIFY_TOKEN); POST takes message status updates and
 * STOP/START messages, signed with X-Hub-Signature-256 (WHATSAPP_APP_SECRET). Anything unsigned or wrongly signed: 403.
 */
const MAX_BODY = 256 * 1024;

export async function GET(req: Request): Promise<Response> {
  const s = whatsappSettings();
  const q = new URL(req.url).searchParams;
  if (!s.verifyToken) return Response.json({ error: "Webhook not configured" }, { status: 503 });
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === s.verifyToken)
    return new Response(q.get("hub.challenge") ?? "", {
      headers: { "content-type": "text/plain" },
    });
  return Response.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(req: Request): Promise<Response> {
  const s = whatsappSettings();
  if (!s.appSecret) return Response.json({ error: "Webhook not configured" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "Too large" }, { status: 413 });
  if (!verifyMetaSignature(s.appSecret, raw, req.headers.get("x-hub-signature-256")))
    return Response.json({ error: "Invalid signature" }, { status: 403 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const r = await handleWhatsAppWebhook(payload);
  return Response.json({ ok: true, statuses: r.statuses });
}
