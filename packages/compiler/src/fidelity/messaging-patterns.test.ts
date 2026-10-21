import { describe, expect, it } from "vitest";
import { detectMessaging, messagingPatterns, reminderHours } from "./patterns.js";

/**
 * Appointment reminders and messaging channels (ADR-0070), detected by code from the request's words. Fixtures are
 * synthetic paraphrases of the kinds of requests seen in production.
 */
const byId = (prompt: string, recipe = "bookings") =>
  Object.fromEntries(messagingPatterns(prompt, recipe).map((p) => [p.id, p.params]));

describe("reminder and messaging patterns (ADR-0070)", () => {
  it("a WhatsApp reminder N hours before each appointment selects reminders on WhatsApp with those hours", () => {
    const p = byId(
      "Online booking for a podiatry practice in Madrid: clients book 40-minute visits on a public page. Also send a WhatsApp reminder to the client 48 hours before each visit.",
    );
    expect(p.reminders).toEqual({
      hoursBefore: 48,
      channels: ["whatsapp"],
      whatsappTemplate: { name: "appointment_reminder", language: "en" },
      maxAttempts: 3,
    });
    expect(p["messaging.whatsapp"]).toEqual({ defaultCountry: "ES", maxAttempts: 3 });
    expect(p["messaging.sms"]).toBeUndefined();
  });

  it("a request that only says 'with reminders' gets email reminders 24 hours before (stated as assumptions)", () => {
    const all = messagingPatterns(
      "an appointment agent for a vet clinic with reminders",
      "bookings",
    );
    const reminders = all.find((p) => p.id === "reminders");
    expect(reminders?.params).toMatchObject({ hoursBefore: 24, channels: ["email"] });
    expect(reminders?.assumptions).toEqual([
      "Reminder time not stated: 24 hours before each appointment.",
      "Reminder channel not stated: email.",
    ]);
    expect(all.map((p) => p.id)).toEqual(["reminders"]);
  });

  it("an SMS reminder '24h before' with card payment and a native app: reminders by SMS only", () => {
    const p = byId(
      "Booking site for a barber shop with online card payment when booking and an SMS reminder 24h before plus an Android app for the barbers.",
    );
    expect(p.reminders).toMatchObject({ hoursBefore: 24, channels: ["sms"] });
    expect(p["messaging.sms"]).toEqual({ defaultCountry: null, maxAttempts: 3 });
  });

  it("the day before, by email and SMS", () => {
    expect(
      byId(
        "A yoga studio booking site. Members get an email and a text message reminder the day before their class.",
      ).reminders,
    ).toMatchObject({ hoursBefore: 24, channels: ["email", "sms"] });
    expect(reminderHours("remind them 2 days in advance")).toBe(48);
    expect(reminderHours("a reminder one hour before")).toBe(1);
  });

  it("reminders only exist in booking apps; overdue reminders are scheduled digests, not appointment reminders", () => {
    expect(
      byId("A task tracker where overdue tasks get an email reminder every morning", "projects"),
    ).toEqual({});
    expect(
      byId("A booking site for a salon; overdue invoices get a reminder", "bookings").reminders,
    ).toBeUndefined();
  });

  it("a WhatsApp link, a 'text field' or the text of a page select no messaging component", () => {
    const all = (p: string) => detectMessaging([p]).map((x) => x.id);
    expect(
      all("The footer has a click-to-chat WhatsApp button and links to our Instagram"),
    ).toEqual([]);
    expect(all("Admins edit the text of each page and send it for review")).toEqual([]);
    expect(all("Customers receive an SMS when their order ships")).toEqual(["messaging.sms"]);
    expect(all("Send a WhatsApp notification when the repair is ready")).toEqual([
      "messaging.whatsapp",
    ]);
  });
});
