import { createHmac, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * Twilio Messages API mock for offline tests (component messaging.sms.twilio), recorded from Twilio's documentation
 * (2026-10): POST /2010-04-01/Accounts/{AccountSid}/Messages.json with HTTP Basic auth and a form body. It refuses
 * what the real endpoint refuses — wrong credentials (401, 20003), a To that is not E.164 (400, 21211), a sender that
 * is not the account's number or messaging service (400, 21606), an empty body (400, 21602) or one over 1,600
 * characters (400, 21617), a recipient who replied STOP (400, 21610) — and, when a StatusCallback is given, posts the
 * delivery update back signed with X-Twilio-Signature like Twilio does.
 * Test hooks: GET|DELETE /__mock/requests, POST|DELETE /__mock/fail {status, times, code?, retryAfter?}, POST /__mock/optout
 * {phone}, GET /health.
 */
export interface TwilioMockOptions {
  accountSid: string;
  authToken: string;
  from: string | null;
  messagingServiceSid?: string | null;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  form: Record<string, string>;
}

const E164 = /^\+[1-9]\d{6,14}$/;

const sign = (token: string, url: string, params: Record<string, string>) =>
  createHmac("sha1", token)
    .update(
      url +
        Object.keys(params)
          .sort()
          .map((k) => `${k}${params[k]}`)
          .join(""),
    )
    .digest("base64");

export function startTwilioMock(opts: TwilioMockOptions, port = 0): Promise<Server> {
  const requests: RecordedRequest[] = [];
  const failures: { status: number; times: number; code: number; retryAfter: string | null }[] = [];
  const optedOut = new Set<string>();
  const error = (status: number, code: number, message: string) => ({
    status,
    body: { code, message, more_info: `https://www.twilio.com/docs/errors/${code}`, status },
  });
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://mock");
      const raw = Buffer.concat(chunks).toString("utf8");
      const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/health") return send(200, { ok: true });
      if (url.pathname === "/__mock/requests") {
        if (req.method === "DELETE") requests.length = 0;
        return send(200, requests);
      }
      if (url.pathname === "/__mock/fail" && req.method === "DELETE") {
        failures.length = 0;
        return send(204, {});
      }
      if (url.pathname === "/__mock/fail" && req.method === "POST") {
        const f = JSON.parse(raw || "{}") as Record<string, unknown>;
        failures.push({
          status: Number(f.status ?? 503),
          times: Number(f.times ?? 1),
          code: Number(f.code ?? 20500),
          retryAfter: f.retryAfter != null ? String(f.retryAfter) : null,
        });
        return send(204, {});
      }
      if (url.pathname === "/__mock/optout" && req.method === "POST") {
        optedOut.add(String((JSON.parse(raw || "{}") as { phone?: string }).phone ?? ""));
        return send(204, {});
      }
      const form = Object.fromEntries(new URLSearchParams(raw));
      requests.push({
        method: req.method ?? "GET",
        path: url.pathname,
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
        form,
      });
      const m = /^\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/.exec(url.pathname);
      if (!m || req.method !== "POST")
        return send(404, error(404, 20404, "The requested resource was not found").body);
      const auth = Buffer.from(
        (req.headers.authorization ?? "").replace(/^Basic /, ""),
        "base64",
      ).toString();
      if (m[1] !== opts.accountSid || auth !== `${opts.accountSid}:${opts.authToken}`)
        return send(401, error(401, 20003, "Authenticate").body);
      const fail = failures.find((f) => f.times > 0);
      if (fail) {
        fail.times -= 1;
        const e = error(fail.status, fail.code, "Mock failure");
        return send(e.status, e.body, fail.retryAfter ? { "retry-after": fail.retryAfter } : {});
      }
      const to = form.To ?? "";
      if (!E164.test(to)) {
        const e = error(400, 21211, `The 'To' number ${to} is not a valid phone number.`);
        return send(e.status, e.body);
      }
      const sender = form.MessagingServiceSid
        ? form.MessagingServiceSid === opts.messagingServiceSid
        : form.From === opts.from && opts.from !== null;
      if (!sender) {
        const e = error(400, 21606, "The From phone number is not a valid, SMS-capable number");
        return send(e.status, e.body);
      }
      const body = form.Body ?? "";
      if (!body) return send(400, error(400, 21602, "Message body is required.").body);
      if (body.length > 1600)
        return send(
          400,
          error(400, 21617, "The concatenated message body exceeds the 1600 character limit.").body,
        );
      if (optedOut.has(to))
        return send(400, error(400, 21610, "Attempt to send to unsubscribed recipient").body);
      const sid = `SM${randomBytes(16).toString("hex")}`;
      send(201, {
        sid,
        account_sid: opts.accountSid,
        to,
        from: form.From ?? null,
        messaging_service_sid: form.MessagingServiceSid ?? null,
        body,
        status: "queued",
        num_segments: String(Math.ceil(body.length / 153)),
        direction: "outbound-api",
        error_code: null,
        error_message: null,
        api_version: "2010-04-01",
        uri: `/2010-04-01/Accounts/${opts.accountSid}/Messages/${sid}.json`,
      });
      const callback = form.StatusCallback;
      if (callback) {
        // Twilio reports delivery to the StatusCallback URL, signed with the account's auth token.
        setTimeout(() => {
          const params = {
            AccountSid: opts.accountSid,
            MessageSid: sid,
            SmsSid: sid,
            MessageStatus: "delivered",
            To: to,
            From: form.From ?? "",
            ApiVersion: "2010-04-01",
          };
          fetch(callback, {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              "x-twilio-signature": sign(opts.authToken, callback, params),
            },
            body: new URLSearchParams(params).toString(),
          }).catch(() => undefined);
        }, 50);
      }
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
