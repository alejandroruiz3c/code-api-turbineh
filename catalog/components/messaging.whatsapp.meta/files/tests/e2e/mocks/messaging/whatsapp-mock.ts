import { createHmac, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * WhatsApp Business Cloud API mock for offline tests (component messaging.whatsapp.meta), recorded from Meta's
 * documentation (2026-10): POST /{version}/{phone-number-id}/messages with a Bearer token and a JSON body. It refuses
 * what the real endpoint refuses — an unknown token (401, OAuthException 190), another phone number id (400, 100),
 * messaging_product other than "whatsapp" (400, 100), a recipient that is not a phone number (400, 131026), a template
 * that is not approved in that language (404, 132001), a different number of body parameters than the template has
 * (400, 132000), free-form text outside the 24-hour window (400, 131047) — answers like Meta (contacts[].wa_id,
 * messages[].id "wamid.…") and, when a webhook URL is given, posts the "sent" and "delivered" statuses signed with
 * X-Hub-Signature-256 like Meta does.
 * Test hooks: GET|DELETE /__mock/requests, POST|DELETE /__mock/fail {status, times, code?}, GET /health.
 */
export interface WhatsAppMockOptions {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  /** Approved templates: "name/language" → number of {{n}} parameters in the body. */
  templates: Record<string, number>;
  /** Where the business's webhook is subscribed (statuses are posted there). */
  webhookUrl?: string | null;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  json: Record<string, unknown> | null;
}

export const DEFAULT_TEMPLATES: Record<string, number> = {
  "appointment_reminder/en": 4,
  "appointment_reminder/es": 4,
  "hello_world/en_US": 0,
};

export function startWhatsAppMock(opts: WhatsAppMockOptions, port = 0): Promise<Server> {
  const requests: RecordedRequest[] = [];
  const failures: { status: number; times: number; code: number }[] = [];
  const graphError = (status: number, code: number, message: string) => ({
    status,
    body: {
      error: {
        message,
        type: "OAuthException",
        code,
        error_data: { messaging_product: "whatsapp", details: message },
        fbtrace_id: randomBytes(8).toString("hex"),
      },
    },
  });
  const notify = (statuses: Record<string, unknown>[]) => {
    if (!opts.webhookUrl) return;
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "mock-waba",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15550001111",
                  phone_number_id: opts.phoneNumberId,
                },
                statuses,
              },
            },
          ],
        },
      ],
    });
    const signature = `sha256=${createHmac("sha256", opts.appSecret).update(body).digest("hex")}`;
    return fetch(opts.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      body,
    }).catch(() => undefined);
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://mock");
      const raw = Buffer.concat(chunks).toString("utf8");
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/health") return send(200, { ok: true });
      if (url.pathname === "/__mock/requests") {
        if (req.method === "DELETE") requests.length = 0;
        return send(200, requests);
      }
      if (url.pathname === "/__mock/fail") {
        if (req.method === "DELETE") failures.length = 0;
        else {
          const f = JSON.parse(raw || "{}") as Record<string, unknown>;
          failures.push({
            status: Number(f.status ?? 503),
            times: Number(f.times ?? 1),
            code: Number(f.code ?? 131000),
          });
        }
        return send(200, { ok: true });
      }
      let json: Record<string, unknown> | null;
      try {
        json = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      } catch {
        json = null;
      }
      requests.push({
        method: req.method ?? "GET",
        path: url.pathname,
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
        json,
      });
      const m = /^\/v\d+\.\d+\/([^/]+)\/messages$/.exec(url.pathname);
      if (!m || req.method !== "POST") {
        const e = graphError(400, 100, "Unsupported request");
        return send(e.status, e.body);
      }
      if (req.headers.authorization !== `Bearer ${opts.accessToken}`) {
        const e = graphError(401, 190, "Invalid OAuth access token - Cannot parse access token");
        return send(e.status, e.body);
      }
      const fail = failures.find((f) => f.times > 0);
      if (fail) {
        fail.times -= 1;
        const e = graphError(fail.status, fail.code, "Mock failure");
        return send(e.status, e.body);
      }
      if (m[1] !== opts.phoneNumberId) {
        const e = graphError(400, 100, "Unsupported post request. Object does not exist");
        return send(e.status, e.body);
      }
      if (!json || json.messaging_product !== "whatsapp") {
        const e = graphError(400, 100, "(#100) The parameter messaging_product is required.");
        return send(e.status, e.body);
      }
      const to = String(json.to ?? "");
      if (!/^\+?[1-9]\d{6,14}$/.test(to)) {
        const e = graphError(400, 131026, "Message Undeliverable.");
        return send(e.status, e.body);
      }
      if (json.type === "text") {
        // No conversation opened by the customer in the last 24 hours (this mock never has one).
        const e = graphError(400, 131047, "Re-engagement message");
        return send(e.status, e.body);
      }
      const t = (json.template ?? {}) as {
        name?: string;
        language?: { code?: string };
        components?: { type?: string; parameters?: { type?: string; text?: string }[] }[];
      };
      const key = `${t.name}/${t.language?.code}`;
      const expected = opts.templates[key];
      if (json.type !== "template" || expected === undefined) {
        const e = graphError(404, 132001, "Template name does not exist in the translation");
        return send(e.status, e.body);
      }
      const params = (t.components ?? []).find((c) => c.type === "body")?.parameters ?? [];
      if (params.length !== expected || params.some((p) => p.type !== "text" || !p.text)) {
        const e = graphError(
          400,
          132000,
          "Number of parameters does not match the expected number of params",
        );
        return send(e.status, e.body);
      }
      const id = `wamid.${randomBytes(24).toString("base64url")}`;
      const waId = to.replace(/^\+/, "");
      send(200, {
        messaging_product: "whatsapp",
        contacts: [{ input: to, wa_id: waId }],
        messages: [{ id, message_status: "accepted" }],
      });
      const now = () => String(Math.floor(Date.now() / 1000));
      setTimeout(async () => {
        await notify([{ id, status: "sent", timestamp: now(), recipient_id: waId }]);
        await notify([{ id, status: "delivered", timestamp: now(), recipient_id: waId }]);
      }, 50);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
