import { createServer } from "node:http";
import { startImapMock } from "./imap/server";

/**
 * E2E mailbox (component email.inbox.imapflow): playwright.config.ts starts this file, points MAIL_IMAP_MOCK at its
 * HTTP control port and the app's MAIL_IMAP_HOST / MAIL_IMAP_PORT / MAIL_IMAP_USER / MAIL_IMAP_PASSWORD at the local
 * IMAP server it runs on MAIL_IMAP_PORT (throwaway password generated per run). Control API for tests:
 * GET /health, POST /__mock/messages {raw, seen?} → {uid}, GET /__mock/commands, GET /__mock/messages.
 */
const httpPort = Number(process.env.PORT ?? 0);
const imapPort = Number(process.env.MAIL_IMAP_PORT ?? httpPort + 1000);
const imap = await startImapMock(
  {
    user: process.env.MAIL_IMAP_USER ?? "inbox-e2e@example.com",
    ...(process.env.MAIL_IMAP_PASSWORD ? { password: process.env.MAIL_IMAP_PASSWORD } : {}),
    ...(process.env.MAIL_IMAP_ACCESS_TOKEN
      ? { accessToken: process.env.MAIL_IMAP_ACCESS_TOKEN }
      : {}),
  },
  imapPort,
);

createServer((req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
  if (req.method === "GET" && req.url === "/__mock/commands") return send(200, imap.commands);
  if (req.method === "GET" && req.url === "/__mock/messages")
    return send(
      200,
      imap.messages.map((m) => ({ uid: m.uid, flags: m.flags })),
    );
  if (req.method === "POST" && req.url === "/__mock/messages") {
    let raw = "";
    req.on("data", (d: Buffer) => (raw += d.toString("utf8")));
    req.on("end", () => {
      try {
        const body = JSON.parse(raw) as { raw?: unknown; seen?: unknown };
        if (typeof body.raw !== "string" || body.raw.length > 1_000_000)
          return send(400, { error: "raw" });
        return send(200, {
          uid: imap.add(body.raw, { flags: body.seen === true ? ["\\Seen"] : [] }),
        });
      } catch {
        return send(400, { error: "invalid JSON" });
      }
    });
    return;
  }
  send(404, { error: "not found" });
}).listen(httpPort, "127.0.0.1", () => {
  console.log(`IMAP mock on 127.0.0.1:${imap.port}, control on ${httpPort}`);
});
