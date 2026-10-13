// Local mock of the Stripe API for the E2E tests (started by playwright.config.ts, which points STRIPE_API_BASE here):
// the paid path runs fully offline. It answers the calls this app makes like Stripe does (Checkout Sessions, billing
// portal sessions), accepts test keys only, and records what it received so tests can check the server's amounts.
// Hosted pages keep Stripe's real addresses; tests answer them with page.route() (no network).
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import process from "node:process";
import { URL, URLSearchParams } from "node:url";

const port = Number(process.env.MOCK_PORT ?? 12100);
const sessions = [];

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const json = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (req.method === "GET" && url.pathname === "/health") return json(200, { ok: true });
    // Test helper: what the app sent, latest first.
    if (req.method === "GET" && url.pathname === "/__sessions")
      return json(200, [...sessions].reverse());
    if (req.method !== "POST")
      return json(404, { error: { message: `mock: ${req.method} ${url.pathname}` } });
    if (!/^Bearer sk_test_/.test(req.headers.authorization ?? "")) {
      return json(401, { error: { message: "Invalid API key (the mock accepts test keys only)" } });
    }
    const params = Object.fromEntries(new URLSearchParams(body));
    if (url.pathname === "/v1/checkout/sessions") {
      const id = `cs_test_${randomUUID().replaceAll("-", "")}`;
      const session = {
        id,
        object: "checkout.session",
        url: `https://checkout.stripe.com/c/pay/${id}`,
        client_reference_id: params.client_reference_id ?? null,
        params,
      };
      sessions.push(session);
      return json(200, session);
    }
    if (url.pathname === "/v1/billing_portal/sessions") {
      const id = `bps_test_${randomUUID().replaceAll("-", "")}`;
      return json(200, {
        id,
        object: "billing_portal.session",
        url: `https://billing.stripe.com/p/session/${id}`,
      });
    }
    json(404, { error: { message: `mock: POST ${url.pathname} is not implemented` } });
  });
}).listen(port, "127.0.0.1");
