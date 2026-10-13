import { describe, expect, it } from "vitest";
import { detectDomains, extractBookingParams } from "./domains.js";

const CAPABILITY_B =
  'Build an AI booking assistant for "Flex Physio", a physiotherapy clinic with three physiotherapists and 45-minute ' +
  "sessions (Monday–Friday 09:00–19:00, Europe/Madrid). Patients chat with the assistant in plain language to: check " +
  "availability, book a session with a chosen or any physiotherapist, reschedule, cancel (not later than 24 hours " +
  "before), and ask common questions (prices: first visit 60 €, follow-up 50 €; address; what to bring). The assistant " +
  "must use tools over the clinic's real data (availability, create/move/cancel booking, find booking by email) and " +
  "never invent a slot; it confirms details before booking and sends a confirmation email. Staff sign in to see and " +
  "manage the bookings. The assistant's language model is reached through an OpenAI-compatible endpoint configured by " +
  "environment variables; tests must use a local mock of that endpoint (no internet in tests). Protect it against " +
  "prompt injection and abuse (input limits, rate limits).";

describe("domain detection (deterministic, ADR-0033)", () => {
  it("extracts every booking parameter of the Capability B request", () => {
    const r = extractBookingParams(CAPABILITY_B, "Flex Physio Assistant");
    expect(r).not.toBeNull();
    const p = r!.params;
    expect(p.business).toBe("Flex Physio");
    expect(p.timeZone).toBe("Europe/Madrid");
    expect(p.resource).toMatchObject({
      singular: "Physiotherapist",
      plural: "Physiotherapists",
      count: 3,
    });
    expect(p.customer.plural).toBe("patients");
    expect(p.hours).toEqual(
      [1, 2, 3, 4, 5].map((weekday) => ({ weekday, open: "09:00", close: "19:00" })),
    );
    expect(p.services).toEqual([
      { name: "First visit", minutes: 45, price: 60, currency: "EUR" },
      { name: "Follow-up", minutes: 45, price: 50, currency: "EUR" },
    ]);
    expect(p.slotMinutes).toBe(45);
    expect(p.policy.cancelNoticeHours).toBe(24);
    expect(p.faq.map((f) => f.topic)).toEqual(["Prices", "Address", "What to bring"]);
    expect(p.faq[1]?.answer).toBeNull(); // never invented
    expect(r!.assumptions).toEqual([]);
  });

  it("works for other businesses and records its defaults", () => {
    const r = extractBookingParams(
      "Booking app for Bella salon in Paris: 4 stylists (Ana, Luis, Marta and Sol), 30 minute appointments, " +
        "Tue-Sat 10:00-20:00, cancellations 2 days before.",
    );
    expect(r!.params.resource).toMatchObject({
      singular: "Stylist",
      count: 4,
      names: ["Ana", "Luis", "Marta", "Sol"],
    });
    expect(r!.params.timeZone).toBe("Europe/Paris");
    expect(r!.params.hours.map((h) => h.weekday)).toEqual([2, 3, 4, 5, 6]);
    expect(r!.params.policy.cancelNoticeHours).toBe(48);
    expect(r!.assumptions.join(" ")).toMatch(/Time zone inferred/);
  });

  it("reads services listed with their own durations and prices, and the phone field (Sala Nueve)", () => {
    const r = extractBookingParams(
      'Build an online booking site for "Sala Nueve", a hair salon with four stylists. Services: cut 30 min (25 €), ' +
        "colour 90 min (70 €), cut and colour 120 min (90 €). Opening hours Tuesday–Saturday 10:00–20:00, " +
        "Europe/Madrid. Customers pick a service, a stylist (or any) and a free slot, enter name, email and phone, and " +
        "receive a confirmation email with a link to cancel up to 12 hours before. No double bookings, ever.",
    );
    const p = r!.params;
    expect(p.business).toBe("Sala Nueve");
    expect(p.services).toEqual([
      { name: "Cut", minutes: 30, price: 25, currency: "EUR" },
      { name: "Colour", minutes: 90, price: 70, currency: "EUR" },
      { name: "Cut and colour", minutes: 120, price: 90, currency: "EUR" },
    ]);
    expect(p.slotMinutes).toBe(30);
    expect(p.resource).toMatchObject({ singular: "Stylist", count: 4 });
    expect(p.hours.map((h) => h.weekday)).toEqual([2, 3, 4, 5, 6]);
    expect(p.policy.cancelNoticeHours).toBe(12);
    expect(p.askPhone).toBe(true);
    expect(r!.assumptions).toEqual([]);
    expect(detectDomains("Online booking site for a salon", "bookings")[0]?.component).toBe(
      "domain.bookings.turbineh",
    );
  });

  it("only applies to booking requests in a recipe that hosts the domain", () => {
    expect(extractBookingParams("A CRM for sales teams with deals and contacts")).toBeNull();
    expect(detectDomains(CAPABILITY_B, "saas-crud")).toEqual([]);
    const [d] = detectDomains(CAPABILITY_B, "ai-agents");
    expect(d).toMatchObject({
      component: "domain.bookings.turbineh",
      paramsFile: "src/bookings/params.json",
    });
    expect(d!.providedEntities).toEqual(
      expect.arrayContaining(["Booking", "Physiotherapist", "Patient"]),
    );
  });
});
