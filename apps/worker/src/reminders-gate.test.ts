import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { gateOffline } from "./gate-offline.js";
import { checkSpec, REMINDERS_PROMPT } from "./combinations.js";
import { wireFidelitySync } from "./fidelity-wiring.js";
import { requestedComponents } from "./pipeline.js";
import { requireRequirements } from "./required-components.js";
import { loadCatalog } from "./catalog-source.js";

/**
 * Regression (ADR-0070) for booking requests with reminders that production built with 0 criteria met, built without
 * the reminder, or refused: synthetic, paraphrased fixtures (same kind of need, other words and names), shaped like
 * compiled specs, through the scope gate exactly as the worker runs it (code only, no decision engine).
 */
const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const componentsDir = join(root, "catalog/components");

const spec = (s: Partial<BuildSpec> & Pick<BuildSpec, "acceptance_criteria">): BuildSpec =>
  ({
    recipe: "bookings",
    out_of_scope_reason: null,
    closest_recipe: null,
    app_name: "Example",
    slug: "example",
    summary: "A booking app compiled from a request.",
    roles: ["owner", "staff"],
    entities: [],
    pages: [{ path: "/", purpose: "Home page", auth_required: false }],
    capabilities: ["security.headers"],
    ...s,
  }) as BuildSpec;

describe("appointment reminders in the scope gate (ADR-0070)", () => {
  it("'an appointment agent for a clinic with reminders': the email reminder is a proven function, nothing is refused", async () => {
    const prompt = "an appointment agent for a vet clinic with reminders";
    const {
      verdict,
      proven,
      spec: out,
    } = await gateOffline(
      prompt,
      spec({
        acceptance_criteria: [
          "Given a client picks a free slot, when they confirm, then the appointment is stored.",
          "Given a booked visit, when it is 24 hours away, then an automated email reminder is sent to the client.",
        ],
      }),
      root,
    );
    expect(requestedComponents(prompt, out, componentsDir)).toEqual(["domain.reminders.turbineh"]);
    expect([...proven]).toContain(
      "A customer gets an email reminder the set number of hours before the appointment, once per appointment",
    );
    expect(verdict.status).toBe("covered");
  });

  it("a WhatsApp reminder N hours before each appointment is covered and proven (it was removed from scope before)", async () => {
    const prompt =
      "Booking site for a podiatry practice: patients book 40-minute visits on a public page and get a confirmation email with a cancel link. Also send a WhatsApp reminder to the patient 24 hours before each visit.";
    const { verdict, proven } = await gateOffline(
      prompt,
      spec({
        acceptance_criteria: [
          "A patient books a 40-minute visit on the public booking page.",
          "The system sends an automated WhatsApp message to the patient 24 hours before their scheduled visit.",
        ],
      }),
      root,
    );
    expect([...proven]).toContain(
      "A customer who opted in gets a WhatsApp reminder the set number of hours before the appointment, once",
    );
    expect(verdict.notCovered).toEqual([]);
    expect(verdict.status).toBe("covered");
  });

  it("an SMS reminder with a native app: the SMS reminder is proven, only the native app is left out", async () => {
    const prompt =
      "Booking site for a barber shop with an SMS reminder 24h before plus an Android app for the barbers.";
    const { verdict, proven } = await gateOffline(
      prompt,
      spec({
        acceptance_criteria: [
          "Given an appointment exists, when it is 24 hours before it, then an SMS reminder is automatically sent to the client's phone number.",
          "Given a barber uses the Android app, then new appointments appear there.",
        ],
      }),
      root,
    );
    expect([...proven]).toContain(
      "A customer who agreed to SMS reminders gets an SMS reminder the set number of hours before the appointment, once",
    );
    expect(verdict.notCovered.map((r) => r.why)).toEqual([
      "It needs a native mobile app: TurbineH builds web apps only",
    ]);
    expect(verdict.status).toBe("partial");
  });

  it("precision: a WhatsApp chatbot stays not covered", async () => {
    const { verdict } = await gateOffline(
      "A clinic assistant that answers patient questions by sending WhatsApp messages",
      spec({
        acceptance_criteria: [
          "The assistant answers patient questions by sending WhatsApp messages in a conversation.",
        ],
      }),
      root,
    );
    expect(verdict.status).toBe("uncovered");
  });
});

describe("reminder components are selected by the fidelity wiring (ADR-0070)", () => {
  it("reminders by email, SMS and WhatsApp select the reminder and messaging components with the request's parameters, and the cron route with no job of its own", () => {
    const { wired } = wireFidelitySync(REMINDERS_PROMPT, checkSpec("bookings", REMINDERS_PROMPT), {
      recipeId: "bookings",
      recipeChain: ["bookings", "saas-crud"],
      componentsDir,
      knownEntities: [],
    });
    const by = Object.fromEntries(wired.selected.map((s) => [s.component, s.params]));
    expect(by["domain.reminders.turbineh"]).toEqual({
      hoursBefore: 24,
      channels: ["email", "sms", "whatsapp"],
      whatsappTemplate: { name: "appointment_reminder", language: "en" },
      maxAttempts: 3,
    });
    expect(by["messaging.sms.twilio"]).toEqual({ defaultCountry: "ES", maxAttempts: 3 });
    expect(by["messaging.whatsapp.meta"]).toEqual({ defaultCountry: "ES", maxAttempts: 3 });
    const required: Record<string, string> = Object.fromEntries(
      wired.selected.map((s) => [s.capability, s.component]),
    );
    const catalog = loadCatalog(componentsDir).map((c) => ({
      id: c.id,
      status: c.status,
      provides: c.provides,
      requires: c.requires,
    }));
    const r = requireRequirements({
      required,
      catalog,
      componentsDir,
      recipe: "bookings",
      patterns: wired.patterns,
      parameterised: new Set(wired.selected.map((s) => s.component)),
    });
    expect(required["jobs.scheduled"]).toBe("jobs.scheduled.turbineh");
    expect(r.domains.find((d) => d.component === "jobs.scheduled.turbineh")?.params).toEqual({
      jobs: [],
      logWhenNoEmailProvider: true,
    });
  });
});
