import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {} }));
const { templateBody, verifyMetaSignature } = await import("@/messaging/whatsapp/cloud-api");
const { waIdToE164, whatsappE164 } = await import("@/messaging/whatsapp/phone");
const { handleWhatsAppWebhook, recordWhatsAppConsent, sendWhatsAppTemplate } =
  await import("@/messaging/whatsapp/service");
const { memoryWhatsAppStore } = await import("./helpers/whatsapp-store");
type WhatsAppSettings = import("@/messaging/whatsapp/config").WhatsAppSettings;

const logOnly: WhatsAppSettings = {
  mode: "log",
  accessToken: null,
  phoneNumberId: null,
  appSecret: null,
  verifyToken: null,
  apiBase: "https://graph.facebook.com",
};
const template = {
  name: "appointment_reminder",
  language: "en",
  bodyParams: ["Ana", "Physio", "Mon 10:30", "Clinic"],
};
const inbound = (from: string, body: string) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        { field: "messages", value: { messages: [{ from, type: "text", text: { body } }] } },
      ],
    },
  ],
});

describe("WhatsApp (messaging.whatsapp.meta)", () => {
  it("builds the documented template message: messaging_product, E.164 recipient, template name, language and body parameters in order", () => {
    expect(templateBody({ to: "+34612345678", template })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+34612345678",
      type: "template",
      template: {
        name: "appointment_reminder",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: template.bodyParams.map((text) => ({ type: "text", text })),
          },
        ],
      },
    });
    expect(whatsappE164("612 345 678", "ES")).toBe("+34612345678");
    expect(whatsappE164("612 345 678")).toBeNull();
    expect(waIdToE164("34612345678")).toBe("+34612345678");
    expect(waIdToE164("+34612345678")).toBeNull();
  });

  it("a WhatsApp message is never sent to a number without opt-in, nor after a STOP message until the person writes START", async () => {
    const { store, log } = memoryWhatsAppStore();
    const fetch = vi.fn();
    const deps = { store, settings: logOnly, fetch };
    const msg = { to: "+34612345678", template, purpose: "reminder" };
    expect(await sendWhatsAppTemplate(msg, deps)).toEqual({
      status: "skipped",
      reason: "no-consent",
    });
    await recordWhatsAppConsent("+34 612 345 678", "form:REF", { store });
    expect((await sendWhatsAppTemplate(msg, deps)).status).toBe("logged");
    expect(await handleWhatsAppWebhook(inbound("34612345678", "Stop"), { store })).toMatchObject({
      optedOut: ["+34612345678"],
    });
    expect(await sendWhatsAppTemplate(msg, deps)).toEqual({
      status: "skipped",
      reason: "opted-out",
    });
    await recordWhatsAppConsent("+34612345678", "form:OTHER", { store });
    expect((await sendWhatsAppTemplate(msg, deps)).status).toBe("skipped");
    await handleWhatsAppWebhook(inbound("34612345678", "START"), { store });
    expect((await sendWhatsAppTemplate(msg, deps)).status).toBe("logged");
    expect(fetch).not.toHaveBeenCalled();
    expect(log.map((r) => r.status)).toEqual(["skipped", "logged", "skipped", "skipped", "logged"]);
  });

  it("WhatsApp webhook calls are checked with X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret) and delivery statuses are recorded", async () => {
    const secret = `s-${Date.now()}`;
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const good = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(verifyMetaSignature(secret, raw, good)).toBe(true);
    expect(verifyMetaSignature(secret, `${raw} `, good)).toBe(false);
    expect(verifyMetaSignature("other", raw, good)).toBe(false);
    expect(verifyMetaSignature(secret, raw, null)).toBe(false);
    const { store, log } = memoryWhatsAppStore();
    log.push({ to: "+34612345678", status: "accepted", reason: null, providerId: "wamid.1" });
    const r = await handleWhatsAppWebhook(
      {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  statuses: [
                    { id: "wamid.1", status: "delivered" },
                    { id: "wamid.unknown", status: "read" },
                  ],
                },
              },
            ],
          },
        ],
      },
      { store },
    );
    expect(r.statuses).toBe(1);
    expect(log[0]?.status).toBe("delivered");
  });
});
