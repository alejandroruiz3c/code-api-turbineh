import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Consent and sending are tested without a database: the client module is replaced and an in-memory store with the
// same rules as the Postgres one (a STOP reply is only undone by START) stands in for it.
vi.mock("@/db/client", () => ({ db: {} }));

const { SmsParams } = await import("@/messaging/sms/config");
const { replyKind } = await import("@/messaging/sms/keywords");
const { maskPhone, toE164 } = await import("@/messaging/sms/phone");
const { handleTwilioWebhook, recordSmsConsent, sendSms, waitBefore } =
  await import("@/messaging/sms/service");
const { twilioSignature, verifyTwilioSignature } = await import("@/messaging/sms/twilio");
const { memoryStore } = await import("./helpers/sms-store");
type SmsSettings = import("@/messaging/sms/config").SmsSettings;

const logOnly: SmsSettings = {
  mode: "log",
  accountSid: null,
  authToken: null,
  from: null,
  messagingServiceSid: null,
  apiBase: "https://api.twilio.com",
  appUrl: null,
};

describe("SMS (messaging.sms.twilio)", () => {
  it("phone numbers are validated as E.164 with libphonenumber-js: a national number needs the app's default country", () => {
    expect(toE164("+34 612 34 56 78")).toBe("+34612345678");
    expect(toE164("612 345 678", "ES")).toBe("+34612345678");
    expect(toE164("612 345 678")).toBeNull();
    expect(toE164("+1 (415) 555-2671")).toBe("+14155552671");
    // Right length but not a number any carrier uses, letters, or too short: refused.
    expect(toE164("+34 012 345 678")).toBeNull();
    expect(toE164("call me")).toBeNull();
    expect(toE164("+34 6")).toBeNull();
    expect(maskPhone("+34612345678")).toBe("+346•••••678");
    expect(SmsParams.safeParse({ defaultCountry: "Spain", maxAttempts: 3 }).success).toBe(false);
  });

  it("reads STOP, START and HELP replies the way Twilio's default opt-out does", () => {
    for (const w of ["STOP", " stop ", "Stop.", "UNSUBSCRIBE", "cancel", "END", "quit", "STOPALL"])
      expect(replyKind(w), w).toBe("opt-out");
    for (const w of ["START", "unstop", "Yes"]) expect(replyKind(w), w).toBe("opt-in");
    expect(replyKind("HELP")).toBe("help");
    // A sentence that contains the word is a normal reply, not a keyword.
    expect(replyKind("Please don't stop my appointment")).toBe("other");
    // Twilio Advanced Opt-Out tells us the type (custom keywords included).
    expect(replyKind("BAJA", "STOP")).toBe("opt-out");
  });

  it("an SMS is never sent to a number without consent, nor after a STOP reply until the person replies START", async () => {
    const { store, log } = memoryStore();
    const fetch = vi.fn();
    const deps = { store, settings: logOnly, fetch };
    expect(await sendSms({ to: "+34612345678", body: "Hi", purpose: "test" }, deps)).toEqual({
      status: "skipped",
      reason: "no-consent",
    });
    expect(await recordSmsConsent("+34 612 345 678", "form:ABC", { store })).toBe("+34612345678");
    expect((await sendSms({ to: "+34612345678", body: "Hi", purpose: "test" }, deps)).status).toBe(
      "logged",
    );
    await handleTwilioWebhook({ From: "+34612345678", Body: "STOP", MessageSid: "SMx" }, { store });
    expect(await sendSms({ to: "+34612345678", body: "Hi", purpose: "test" }, deps)).toEqual({
      status: "skipped",
      reason: "opted-out",
    });
    // A form tick never overrides a STOP; a START reply does.
    await recordSmsConsent("+34612345678", "form:DEF", { store });
    expect((await sendSms({ to: "+34612345678", body: "Hi", purpose: "test" }, deps)).status).toBe(
      "skipped",
    );
    await handleTwilioWebhook(
      { From: "+34612345678", Body: "start", MessageSid: "SMy" },
      { store },
    );
    expect((await sendSms({ to: "+34612345678", body: "Hi", purpose: "test" }, deps)).status).toBe(
      "logged",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(log.map((r) => r.status)).toEqual(["skipped", "logged", "skipped", "skipped", "logged"]);
  });

  it("without Twilio credentials an SMS is logged, not sent, and an invalid number is never tried", async () => {
    const { store, log } = memoryStore();
    const fetch = vi.fn();
    await recordSmsConsent("+14155552671", "form:X", { store });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect(
      await sendSms(
        { to: "+14155552671", body: "Your secret code", purpose: "reminder" },
        { store, settings: logOnly, fetch },
      ),
    ).toEqual({ status: "logged" });
    // The log line says a message was not sent; never its text or number.
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/secret code|4155552671/);
    info.mockRestore();
    expect(
      await sendSms({ to: "12", body: "x", purpose: "reminder" }, { store, settings: logOnly }),
    ).toEqual({ status: "skipped", reason: "invalid-number" });
    expect(fetch).not.toHaveBeenCalled();
    expect(log.at(-1)?.reason).toBe("invalid number");
  });

  it("waits between attempts grow exponentially with jitter, up to a ceiling", () => {
    expect(waitBefore(1, () => 0)).toBe(250);
    expect(waitBefore(1, () => 0.999)).toBeLessThanOrEqual(500);
    expect(waitBefore(2, () => 1)).toBe(1000);
    expect(waitBefore(10, () => 1)).toBe(4000);
  });

  it("checks X-Twilio-Signature over the full URL and the sorted POST parameters (HMAC-SHA1, base64)", () => {
    const token = `t-${Date.now()}`;
    const url = "https://clinic.example.com/api/messaging/sms/webhook?x=1";
    const params = { To: "+15005550006", From: "+34612345678", Body: "STOP", MessageSid: "SM1" };
    // Twilio's documented algorithm, written out independently of the implementation.
    const expected = createHmac("sha1", token)
      .update(`${url}BodySTOPFrom+34612345678MessageSidSM1To+15005550006`)
      .digest("base64");
    expect(twilioSignature(token, url, params)).toBe(expected);
    expect(verifyTwilioSignature(token, url, params, expected)).toBe(true);
    expect(verifyTwilioSignature(token, url, { ...params, Body: "START" }, expected)).toBe(false);
    expect(verifyTwilioSignature(token, `${url}&y=2`, params, expected)).toBe(false);
    expect(verifyTwilioSignature(token, url, params, null)).toBe(false);
  });
});
