import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TEMPLATES,
  startWhatsAppMock,
  type RecordedRequest,
} from "../e2e/mocks/messaging/whatsapp-mock";

vi.mock("@/db/client", () => ({ db: {} }));
const { sendTemplate, verifyMetaSignature } = await import("@/messaging/whatsapp/cloud-api");
const { WHATSAPP_GRAPH_VERSION } = await import("@/messaging/whatsapp/config");
const { recordWhatsAppConsent, sendWhatsAppTemplate } =
  await import("@/messaging/whatsapp/service");
const { memoryWhatsAppStore } = await import("./helpers/whatsapp-store");
type WhatsAppSettings = import("@/messaging/whatsapp/config").WhatsAppSettings;

/**
 * Contract tests of messaging.whatsapp.meta against the WhatsApp Cloud API mock, which checks every request the way the
 * documented endpoint does (Bearer token, phone number id, messaging_product, approved template and its parameter
 * count, the 24-hour rule for free-form text) and posts signed status webhooks. Credentials are generated per run.
 */
const accessToken = randomBytes(24).toString("hex");
const appSecret = randomBytes(16).toString("hex");
const phoneNumberId = String(100_000_000_000 + Math.floor(Math.random() * 1e9));
let mock: Server;
let hook: Server;
const hooks: { signature: string | null; body: string }[] = [];
let settings: WhatsAppSettings;
let base = "";
const template = {
  name: "appointment_reminder",
  language: "en",
  bodyParams: ["Ana", "Physio", "Mon 10:30", "Clinic"],
};

beforeAll(async () => {
  hook = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      hooks.push({ signature: (req.headers["x-hub-signature-256"] as string) ?? null, body });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => hook.listen(0, "127.0.0.1", () => r()));
  mock = await startWhatsAppMock({
    accessToken,
    phoneNumberId,
    appSecret,
    templates: DEFAULT_TEMPLATES,
    webhookUrl: `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`,
  });
  base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  settings = {
    mode: "cloud-api",
    accessToken,
    phoneNumberId,
    appSecret,
    verifyToken: "v",
    apiBase: base,
  };
});
afterAll(() => {
  mock.close();
  hook.close();
});

const requests = async () =>
  (await (await fetch(`${base}/__mock/requests`)).json()) as RecordedRequest[];
const reset = () => fetch(`${base}/__mock/requests`, { method: "DELETE" });

describe("WhatsApp Cloud API contract (messaging.whatsapp.meta)", () => {
  it("a WhatsApp template message is sent with the Cloud API (POST /{version}/{phone-number-id}/messages, Bearer token, approved template, E.164 number); Meta's statuses come back signed", async () => {
    await reset();
    const { store, log } = memoryWhatsAppStore();
    await recordWhatsAppConsent("+34612345678", "form:REF1", { store });
    const r = await sendWhatsAppTemplate(
      { to: "+34 612 345 678", template, purpose: "reminder", reference: "REF1" },
      { store, settings },
    );
    expect(r).toMatchObject({ status: "accepted", attempts: 1 });
    const [req] = await requests();
    expect(req?.path).toBe(`/${WHATSAPP_GRAPH_VERSION}/${phoneNumberId}/messages`);
    expect(req?.headers.authorization).toBe(`Bearer ${accessToken}`);
    expect(req?.headers["content-type"]).toBe("application/json");
    expect(req?.json).toMatchObject({
      messaging_product: "whatsapp",
      to: "+34612345678",
      type: "template",
      template: { name: "appointment_reminder", language: { code: "en" } },
    });
    expect(log.at(-1)).toMatchObject({
      status: "accepted",
      providerId: r.status === "accepted" ? r.id : "",
    });
    for (let i = 0; i < 40 && hooks.length < 2; i++) await new Promise((t) => setTimeout(t, 25));
    const statuses = hooks.map((h) => {
      expect(verifyMetaSignature(appSecret, h.body, h.signature)).toBe(true);
      return (
        JSON.parse(h.body) as {
          entry: { changes: { value: { statuses: { status: string }[] } }[] }[];
        }
      ).entry[0]?.changes[0]?.value.statuses[0]?.status;
    });
    expect(statuses).toEqual(["sent", "delivered"]);
  });

  it("a template that is not approved (132001) or has another number of parameters (132000) is refused and not retried", async () => {
    expect(
      await sendTemplate(
        { to: "+34612345678", template: { ...template, name: "unknown" } },
        settings,
      ),
    ).toMatchObject({
      ok: false,
      httpStatus: 404,
      code: "132001",
      retryable: false,
    });
    expect(
      await sendTemplate(
        { to: "+34612345678", template: { ...template, bodyParams: ["Ana"] } },
        settings,
      ),
    ).toMatchObject({ ok: false, code: "132000", retryable: false });
    expect(
      await sendTemplate({ to: "+34612345678", template }, { ...settings, accessToken: "expired" }),
    ).toMatchObject({
      ok: false,
      httpStatus: 401,
      code: "190",
      unauthorized: true,
      retryable: false,
    });
  });

  it("a WhatsApp message that fails with a throughput limit (130429) or 5xx is retried with backoff and then sent, within the attempt limit", async () => {
    await reset();
    const { store, log } = memoryWhatsAppStore();
    await recordWhatsAppConsent("+34612345679", "form:REF2", { store });
    await fetch(`${base}/__mock/fail`, {
      method: "POST",
      body: JSON.stringify({ status: 400, code: 130429, times: 1 }),
    });
    await fetch(`${base}/__mock/fail`, {
      method: "POST",
      body: JSON.stringify({ status: 503, code: 131000, times: 1 }),
    });
    const waits: number[] = [];
    const r = await sendWhatsAppTemplate(
      { to: "+34612345679", template, purpose: "reminder" },
      {
        store,
        settings,
        sleep: async (ms) => void waits.push(ms),
        random: () => 1,
        maxAttempts: 3,
      },
    );
    expect(r).toMatchObject({ status: "accepted", attempts: 3 });
    expect(waits).toEqual([500, 1000]);
    expect(await requests()).toHaveLength(3);
    await fetch(`${base}/__mock/fail`, {
      method: "POST",
      body: JSON.stringify({ status: 503, times: 5 }),
    });
    const gaveUp = await sendWhatsAppTemplate(
      { to: "+34612345679", template, purpose: "reminder" },
      { store, settings, sleep: async () => undefined, maxAttempts: 2 },
    );
    expect(gaveUp).toMatchObject({ status: "failed", retryable: true, attempts: 2 });
    expect(log.at(-1)?.status).toBe("failed");
    await fetch(`${base}/__mock/fail`, { method: "DELETE" });
  });
});
