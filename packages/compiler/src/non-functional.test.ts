import { describe, expect, it } from "vitest";
import { buildSpecSchema, type BuildSpec } from "./build-spec.js";
import { PARTS } from "./parts.js";
import { nameWords, nonFunctionalKind, separateNonFunctional } from "./non-functional.js";

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

const f = (name: string, type: "string" | "integer" | "datetime" | "boolean" = "string") => ({
  name,
  type,
  required: true,
});
const entity = (name: string, ...fields: string[]) => ({
  name,
  fields: (fields.length ? fields : ["name"]).map((x) => f(x)),
});

function spec(
  recipe: BuildSpec["recipe"],
  entities: BuildSpec["entities"],
  pages: string[] = ["/dashboard"],
): BuildSpec {
  return buildSpecSchema.parse({
    recipe,
    out_of_scope_reason: null,
    closest_recipe: null,
    app_name: "Test app",
    slug: "test-app",
    summary: "A test application for the guard.",
    roles: ["owner"],
    entities,
    pages: pages.map((path) => ({ path, purpose: "page", auth_required: true })),
    capabilities: ["security.headers", "data.validation"],
    acceptance_criteria: [
      "Given a user sends many requests, when the limit is exceeded, then 429 is returned.",
      "Given a staff member signs in, then they see the bookings.",
      "Given a patient books, then a confirmation email is sent.",
    ],
  });
}

describe("non-functional requirements are not entities (ADR-0036 §D3)", () => {
  it("splits PascalCase names into words", () => {
    expect(nameWords("RateLimitTracker")).toEqual(["rate", "limit", "tracker"]);
    expect(nameWords("APIRequestLog")).toEqual(["api", "request", "log"]);
    expect(nameWords("rate-limit-trackers")).toEqual(["rate", "limit", "trackers"]);
  });

  it("the entities prompt tells the model, in every build", () => {
    expect(PARTS.entities.instruction).toMatch(/Never list non-functional requirements as entities/);
    expect(PARTS.entities.instruction).toMatch(/rate limits/);
  });

  it("Capability B (66af3182): RateLimitTracker is removed and mapped to rate limiting + AI safety", () => {
    expect(CAPABILITY_B).toMatch(/rate limits/);
    const compiled = spec(
      "ai-agents",
      [
        entity("Physiotherapist", "name", "specialization"),
        entity("TimeSlot", "physiotherapistId", "startTime"),
        entity("Booking", "patientEmail", "physiotherapistId", "timeSlotId"),
        {
          name: "RateLimitTracker",
          fields: [f("email"), f("requestCount", "integer"), f("lastRequestAt", "datetime")],
        },
      ],
      ["/assistant", "/dashboard/rate-limit-trackers", "/dashboard/bookings"],
    );
    const r = separateNonFunctional(compiled);
    expect(r.spec.entities.map((e) => e.name)).toEqual(["Physiotherapist", "TimeSlot", "Booking"]);
    expect(r.requirements).toEqual([
      {
        kind: "rate-limits",
        source: "RateLimitTracker",
        capabilities: ["ops.rate-limit", "security.ai-safety"],
      },
    ]);
    expect(r.spec.capabilities).toEqual(
      expect.arrayContaining(["ops.rate-limit", "security.ai-safety"]),
    );
    expect(r.spec.pages.map((p) => p.path)).toEqual(["/assistant", "/dashboard/bookings"]);
    // Criteria (the requirement itself) are kept; the result is still a valid BuildSpec.
    expect(r.spec.acceptance_criteria).toEqual(compiled.acceptance_criteria);
    expect(buildSpecSchema.safeParse(r.spec).success).toBe(true);
    // Idempotent: a stored spec run through the guard again is unchanged.
    expect(separateNonFunctional(r.spec).spec).toEqual(r.spec);
  });

  it.each([
    ["RateLimit", "rate-limits"],
    ["RequestCounter", "rate-limits"],
    ["ApiThrottle", "rate-limits"],
    ["PromptInjectionRule", "abuse-protection"],
    ["InputLimit", "abuse-protection"],
    ["MessageLimit", "abuse-protection"],
    ["SpamCheck", "abuse-protection"],
    ["ContactFormCaptcha", "abuse-protection"],
    ["RequestTimeout", "timeouts-retries"],
    ["RetryPolicy", "timeouts-retries"],
    ["AuditLog", "logging"],
    ["AuditTrailEntry", "logging"],
    ["RequestLog", "logging"],
    ["ErrorLog", "logging"],
    ["CacheEntry", "caching"],
    ["IdempotencyKey", "idempotency"],
    ["HealthCheck", "monitoring"],
  ])("%s is a non-functional requirement (%s)", (name, kind) => {
    expect(nonFunctionalKind(name)).toBe(kind);
  });

  // Entities a correct compilation of every spec in bench/frontiers/learning.md (and spec.md) needs: none is removed.
  it.each([
    ["saas-crud (Fieldnote)", ["Note", "Tag", "Interview", "Customer"]],
    ["client-portal (Ledgerline)", ["Client", "DocumentRequest", "Document", "Message"]],
    ["corporate-site (Altamira)", ["Project", "Position", "ContactRequest", "TeamMember", "Sector"]],
    ["landing-waitlist (Orbit Notes)", ["WaitlistEntry", "Referral"]],
    ["bookings (Sala Nueve)", ["Service", "Stylist", "Booking", "TimeOff"]],
    ["projects (Brickline)", ["Project", "Phase", "Task", "Comment", "Attachment"]],
    ["tracker (Kilnwise)", ["Piece", "StageChange", "StageLimit", "Log", "Stage"]],
    ["internal-tool (Pixelyard)", ["EquipmentItem", "Loan", "LoanRequest", "ReturnCheck"]],
    ["analytics (Brightside)", ["Shop", "Product", "SalesRecord", "Metric", "ImportReport"]],
    ["booking agent (Flex Physio)", ["Physiotherapist", "Session", "TimeSlot", "Booking", "Faq"]],
    ["shop", ["Product", "Order", "Coupon", "ShippingRate", "StockLevel"]],
  ])("keeps every real entity of %s", (_name, names) => {
    for (const n of names) expect(nonFunctionalKind(n), n).toBeNull();
  });

  it.each([
    // corporate-site: "stored, rate-limited, protected against spam"
    ["corporate-site", ["ContactRequest", "RateLimitEntry", "SpamFilter"], ["ContactRequest"]],
    // saas-crud: "Every change is recorded in an audit log visible to owners" → logging capability, not CRUD
    ["saas-crud", ["Note", "Tag", "AuditLog"], ["Note", "Tag"]],
    // landing-waitlist: abuse protection on the public form
    ["landing-waitlist", ["WaitlistEntry", "Referral", "SignupThrottle"], ["WaitlistEntry", "Referral"]],
  ] as const)("%s: removes non-functional entities only", (recipe, all, kept) => {
    const r = separateNonFunctional(
      spec(
        recipe,
        all.map((n) => entity(n)),
      ),
    );
    expect(r.spec.entities.map((e) => e.name)).toEqual(kept);
    expect(r.spec.capabilities).not.toContain("security.ai-safety");
  });

  it("drops a reference field to a removed entity", () => {
    const r = separateNonFunctional(
      spec("saas-crud", [entity("RateLimit", "key"), entity("Note", "title", "rateLimitId")]),
    );
    expect(r.spec.entities).toEqual([entity("Note", "title")]);
  });
});
