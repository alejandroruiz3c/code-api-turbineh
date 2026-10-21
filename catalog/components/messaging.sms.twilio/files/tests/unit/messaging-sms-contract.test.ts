import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTwilioMock, type RecordedRequest } from "../e2e/mocks/messaging/twilio-mock";

vi.mock("@/db/client", () => ({ db: {} }));
const { recordSmsConsent, sendSms } = await import("@/messaging/sms/service");
const { sendViaTwilio, verifyTwilioSignature } = await import("@/messaging/sms/twilio");
const { memoryStore } = await import("./helpers/sms-store");
type SmsSettings = import("@/messaging/sms/config").SmsSettings;

/**
 * Contract tests of messaging.sms.twilio against the Twilio Messages API mock, which checks every request the way the
 * documented endpoint does (Basic auth, form fields, E.164, sender, body limits, opted-out recipients) and records it.
 * Credentials are generated per run.
 */
const accountSid = `AC${randomBytes(16).toString("hex")}`;
const authToken = randomBytes(16).toString("hex");
const from = "+15005550006";
let mock: Server;
let receiver: Server;
const callbacks: { signature: string | null; body: string }[] = [];
let settings: SmsSettings;
let base = "";

beforeAll(async () => {
  mock = await startTwilioMock({ accountSid, authToken, from });
  base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      callbacks.push({ signature: req.headers["x-twilio-signature"] as string, body });
      res.end("<Response/>");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", () => r()));
  settings = {
    mode: "twilio",
    accountSid,
    authToken,
    from,
    messagingServiceSid: null,
    apiBase: base,
    appUrl: `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`,
  };
});
afterAll(() => {
  mock.close();
  receiver.close();
});

const requests = async () =>
  (await (await fetch(`${base}/__mock/requests`)).json()) as RecordedRequest[];
const fail = (f: Record<string, unknown>) =>
  fetch(`${base}/__mock/fail`, { method: "POST", body: JSON.stringify(f) });

describe("Twilio Messages API contract (messaging.sms.twilio)", () => {
  it("an SMS is sent with Twilio's Messages API (POST /2010-04-01/Accounts/{AccountSid}/Messages.json): Basic auth, form-encoded To as an E.164 number, From, Body and a signed StatusCallback", async () => {
    await fetch(`${base}/__mock/requests`, { method: "DELETE" });
    const { store, log } = memoryStore();
    await recordSmsConsent("+34612345678", "form:REF1", { store });
    const r = await sendSms(
      {
        to: "+34 612 34 56 78",
        body: "Reminder: physio tomorrow 10:30",
        purpose: "reminder",
        reference: "REF1",
      },
      { store, settings },
    );
    expect(r).toMatchObject({ status: "sent", attempts: 1 });
    const [req] = await requests();
    expect(req?.method).toBe("POST");
    expect(req?.path).toBe(`/2010-04-01/Accounts/${accountSid}/Messages.json`);
    expect(req?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(
      Buffer.from(req?.headers.authorization?.replace("Basic ", "") ?? "", "base64").toString(),
    ).toBe(`${accountSid}:${authToken}`);
    expect(req?.form).toEqual({
      To: "+34612345678",
      From: from,
      Body: "Reminder: physio tomorrow 10:30",
      StatusCallback: `${settings.appUrl}/api/messaging/sms/webhook`,
    });
    expect(log.at(-1)).toMatchObject({ status: "sent", to: "+34612345678" });
    // Twilio posts the delivery update back, signed with the auth token: our verifier accepts it.
    for (let i = 0; i < 40 && callbacks.length === 0; i++)
      await new Promise((t) => setTimeout(t, 25));
    const cb = callbacks[0];
    const params = Object.fromEntries(new URLSearchParams(cb?.body ?? ""));
    expect(params.MessageStatus).toBe("delivered");
    expect(params.MessageSid).toBe(r.status === "sent" ? r.sid : "");
    expect(
      verifyTwilioSignature(
        authToken,
        `${settings.appUrl}/api/messaging/sms/webhook`,
        params,
        cb?.signature ?? null,
      ),
    ).toBe(true);
  });

  it("uses MessagingServiceSid instead of From when the app sends through a messaging service", async () => {
    await fetch(`${base}/__mock/requests`, { method: "DELETE" });
    const r = await sendViaTwilio(
      { to: "+14155552671", body: "Hi" },
      { ...settings, from: null, messagingServiceSid: "MG-test-service", appUrl: null },
    );
    // The mock only accepts the account's own number or service: a service it does not know is refused (21606).
    expect(r).toMatchObject({ ok: false, httpStatus: 400, code: "21606", retryable: false });
    expect((await requests())[0]?.form).toEqual({
      To: "+14155552671",
      Body: "Hi",
      MessagingServiceSid: "MG-test-service",
    });
  });

  it("an SMS that fails with 429 or 5xx is retried with backoff and then sent; a refused number (21211) is not retried", async () => {
    await fetch(`${base}/__mock/requests`, { method: "DELETE" });
    const { store } = memoryStore();
    await recordSmsConsent("+34612345679", "form:REF2", { store });
    await fail({ status: 429, times: 1, code: 20429, retryAfter: "1" });
    await fail({ status: 503, times: 1, code: 20500 });
    const waits: number[] = [];
    const r = await sendSms(
      { to: "+34612345679", body: "Hi", purpose: "reminder" },
      {
        store,
        settings: { ...settings, appUrl: null },
        sleep: async (ms) => void waits.push(ms),
        random: () => 0,
        maxAttempts: 3,
      },
    );
    expect(r).toMatchObject({ status: "sent", attempts: 3 });
    expect(waits).toEqual([1000, 500]);
    expect(await requests()).toHaveLength(3);
    const bad = await sendViaTwilio({ to: "34612345678", body: "Hi" }, settings);
    expect(bad).toMatchObject({ ok: false, httpStatus: 400, code: "21211", retryable: false });
  });

  it("gives up after the attempt limit and reports a retryable failure; wrong credentials are refused (20003)", async () => {
    const { store, log } = memoryStore();
    await recordSmsConsent("+34612345670", "form:REF3", { store });
    await fail({ status: 503, times: 5 });
    const r = await sendSms(
      { to: "+34612345670", body: "Hi", purpose: "reminder" },
      {
        store,
        settings: { ...settings, appUrl: null },
        sleep: async () => undefined,
        maxAttempts: 2,
      },
    );
    expect(r).toMatchObject({ status: "failed", retryable: true, attempts: 2 });
    expect(log.at(-1)).toMatchObject({ status: "failed" });
    await fetch(`${base}/__mock/requests`, { method: "DELETE" });
    await fetch(`${base}/__mock/fail`, { method: "DELETE" });
    const denied = await sendViaTwilio(
      { to: "+34612345670", body: "Hi" },
      { ...settings, authToken: "wrong" },
    );
    expect(denied).toMatchObject({ ok: false, httpStatus: 401, code: "20003", retryable: false });
    // The answer that never reaches us is not retried blindly: it may have been sent.
    const lost = await sendViaTwilio({ to: "+34612345670", body: "Hi" }, settings, async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    });
    expect(lost).toMatchObject({ ok: false, unknown: true, retryable: false });
    const refused = await sendViaTwilio({ to: "+34612345670", body: "Hi" }, settings, async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    });
    expect(refused).toMatchObject({ ok: false, unknown: false, retryable: true });
  });

  it("a number Twilio reports as unsubscribed after a STOP (21610) is opted out and never sent an SMS again", async () => {
    const { store, consent } = memoryStore();
    await recordSmsConsent("+34612345671", "form:REF4", { store });
    await fetch(`${base}/__mock/optout`, {
      method: "POST",
      body: JSON.stringify({ phone: "+34612345671" }),
    });
    const r = await sendSms(
      { to: "+34612345671", body: "Hi", purpose: "reminder" },
      { store, settings: { ...settings, appUrl: null } },
    );
    expect(r).toEqual({ status: "skipped", reason: "opted-out" });
    expect(consent.get("+34612345671")).toEqual({ status: "opted_out", source: "provider:21610" });
    await fetch(`${base}/__mock/requests`, { method: "DELETE" });
    expect(
      await sendSms({ to: "+34612345671", body: "Hi", purpose: "reminder" }, { store, settings }),
    ).toEqual({ status: "skipped", reason: "opted-out" });
    expect(await requests()).toEqual([]);
  });
});
