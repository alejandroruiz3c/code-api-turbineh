import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * Shared machinery of the social provider mocks (social.* components): an HTTP server per provider that reproduces the
 * documented request and response shapes (see each provider file), records every request for the tests
 * (GET /__mock/requests) and can be told to fail the next calls of an endpoint (POST /__mock/fail) to prove retries.
 * Tokens it issues are random and exist only in this process.
 */
export interface MockRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
}

export interface Reply {
  status: number;
  json?: unknown;
  html?: string;
  headers?: Record<string, string>;
  redirect?: string;
}

export type Handler = (req: MockRequest, ctx: MockContext) => Reply | Promise<Reply>;

export interface MockContext {
  /** This mock's own origin (for upload URLs it hands out). */
  origin: string;
}

interface Failure {
  match: string;
  status: number;
  times: number;
  json: unknown;
  headers: Record<string, string>;
}

export const token = (prefix: string) => `${prefix}-${randomBytes(18).toString("hex")}`;

export const form = (body: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(body));

export function json(body: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const bearer = (req: MockRequest) =>
  /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? null;

/** The consent page a person sees at the provider: "Allow" returns a code, "Cancel" returns an error. */
export function consentPage(redirect: string, state: string, code: string, title: string): Reply {
  const back = (q: Record<string, string>) =>
    `${redirect}${redirect.includes("?") ? "&" : "?"}${new URLSearchParams(q)}`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return {
    status: 200,
    html: `<!doctype html><html><body><h1>${esc(title)}</h1><p>Mock consent page (offline tests).</p>
<a id="allow" href="${esc(back({ code, state }))}">Allow</a>
<a id="cancel" href="${esc(back({ error: "user_cancelled_authorize", error_description: "The user cancelled", state }))}">Cancel</a>
</body></html>`,
  };
}

export function startMock(handler: Handler, port: number, host = "127.0.0.1"): Promise<Server> {
  const requests: MockRequest[] = [];
  const failures: Failure[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const url = new URL(req.url ?? "/", "http://mock");
      const r: MockRequest = {
        method: req.method ?? "GET",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
        body: Buffer.concat(chunks).toString("latin1"),
      };
      const send = (reply: Reply) => {
        const headers: Record<string, string> = { ...(reply.headers ?? {}) };
        if (reply.redirect) headers.location = reply.redirect;
        if (reply.html !== undefined) headers["content-type"] = "text/html; charset=utf-8";
        else if (reply.json !== undefined) headers["content-type"] = "application/json";
        res.writeHead(reply.status, headers);
        res.end(reply.html ?? (reply.json !== undefined ? JSON.stringify(reply.json) : ""));
      };
      if (r.path === "/health") return send({ status: 200, json: { ok: true } });
      if (r.path === "/__mock/requests") {
        if (r.method === "DELETE") requests.length = 0;
        return send({ status: 200, json: requests });
      }
      if (r.path === "/__mock/fail" && r.method === "POST") {
        const f = json(r.body) ?? {};
        failures.push({
          match: String(f.match ?? ""),
          status: Number(f.status ?? 503),
          times: Number(f.times ?? 1),
          json: f.json ?? { error: "mock failure" },
          headers: (f.headers as Record<string, string>) ?? {},
        });
        return send({ status: 204 });
      }
      requests.push(r);
      const fail = failures.find((f) => f.times > 0 && `${r.method} ${r.path}`.includes(f.match));
      if (fail) {
        fail.times -= 1;
        return send({ status: fail.status, json: fail.json, headers: fail.headers });
      }
      try {
        const address = server.address();
        const origin = `http://${host}:${typeof address === "object" && address ? address.port : port}`;
        send(await handler(r, { origin }));
      } catch (err) {
        send({ status: 500, json: { error: String(err) } });
      }
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
