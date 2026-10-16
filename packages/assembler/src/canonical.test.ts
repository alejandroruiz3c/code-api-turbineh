import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { proofVerdict } from "@turbineh/shared";
import { sourceIn, splitTestRef, testBlocks } from "./acceptance.js";
import { generateEntity } from "./entities.js";
import {
  advertisedFunctions,
  auditRecipe,
  canonicalCriteria,
  canonicalize,
  mapToCanonical,
  resolveCanonical,
} from "./canonical.js";

const recipesDir = join(__dirname, "../../../catalog/recipes");
const componentsDir = join(recipesDir, "..", "components");
const RECIPES = readdirSync(recipesDir).filter((r) =>
  existsSync(join(recipesDir, r, "recipe.yaml")),
);

/** The bookings use case as a build installs it (recipe chain + domain.bookings files, no AI). */
const bookings = () =>
  resolveCanonical(
    canonicalCriteria({ recipesDir, recipe: "bookings" }),
    sourceIn(
      join(recipesDir, "bookings", "template"),
      join(recipesDir, "saas-crud", "template"),
      join(componentsDir, "domain.bookings.turbineh", "files"),
    ),
  );

describe("canonical criteria (ADR-0063)", () => {
  it("splits a catalogue text into the functions it advertises", () => {
    expect(
      advertisedFunctions(
        "Online booking site — public booking page (service, team member or any), no double bookings, time off",
      ),
    ).toEqual([
      "public booking page (service, team member or any)",
      "no double bookings",
      "time off",
    ]);
  });

  // N-01 (external audit v2, flow 52eff6c8): the bookings recipe met 2/5 although its E2E proves the three functions
  // the catalogue advertises. These are the requirements as a request phrases them.
  it.each([
    [
      "A patient can book a 45-minute physiotherapy session on the public booking page without creating an account",
      ["bookings.public-booking"],
    ],
    [
      "After booking, the patient receives a confirmation email with a link to cancel the appointment",
      ["bookings.confirmation-email"],
    ],
    ["The system prevents double bookings of the same time slot", ["bookings.no-double-booking"]],
    [
      "Given a time slot is already booked, when another patient tries to book it, then the booking is rejected",
      ["bookings.no-double-booking"],
    ],
    [
      "Staff see a calendar of appointments per physiotherapist in day and week views",
      ["bookings.staff-calendar"],
    ],
  ])("maps %j to its canonical criterion", (asked, ids) => {
    const aliases = ["patient", "patients", "physiotherapist", "physiotherapists", "physiotherapy"];
    expect(mapToCanonical(asked, bookings(), aliases).map((c) => c.id)).toEqual(ids);
  });

  it.each([
    // A function the use case does not provide is never claimed by a canonical criterion.
    "The patient receives a WhatsApp reminder 24 hours before the appointment",
    "A patient pays a deposit online when booking",
    "Bookings sync with the physiotherapist's Google Calendar",
    // A refusal is claimed only by a canonical criterion that states that refusal.
    "A patient cannot book more than two sessions per week",
  ])("keeps %j out of every canonical criterion", (asked) => {
    expect(mapToCanonical(asked, bookings(), ["patient", "physiotherapist"])).toEqual([]);
  });

  it("canonicalizes once: canonical wording, the request's words kept as asked, idempotent", () => {
    const asked = [
      "A customer books a free slot on the public page without an account",
      "The customer receives a confirmation email with a cancel link",
      "The system sends an SMS reminder the day before",
    ];
    const first = canonicalize(asked, bookings());
    expect(first.criteria).toEqual([
      "A customer books a free time on the public page without an account and the booking is created",
      "A customer books a free time and a confirmation email with a cancel link is sent",
      "The system sends an SMS reminder the day before",
    ]);
    expect(first.links[first.criteria[0] as string]).toBe("bookings.public-booking");
    expect(first.asked[first.criteria[1] as string]).toEqual([asked[1]]);
    const again = canonicalize(first.criteria, bookings(), [], first.asked);
    expect(again.criteria).toEqual(first.criteria);
    expect(again.asked).toEqual(first.asked);
  });

  // The catalogue audit: every function a recipe advertises has a canonical criterion whose linked tests exist in the
  // package and prove its wording.
  it.each(RECIPES)("recipe %s: every advertised function is claimed and proven", (recipe) => {
    const audit = auditRecipe(recipesDir, recipe);
    expect(audit.problems).toEqual([]);
    expect(audit.unclaimed).toEqual([]);
  });
});

describe("generated CRUD canonical criteria (ADR-0063)", () => {
  const contact = {
    name: "Contact",
    fields: [
      { name: "name", type: "string" as const, required: true },
      { name: "email", type: "email" as const, required: false },
    ],
  };
  const files = generateEntity(contact, { csvExport: true, csvImport: true }, [contact], {
    isolation: true,
  });
  const spec = files.find((f) => f.path === "tests/e2e/contacts.spec.ts")?.content ?? "";
  const titles = testBlocks(spec).map((b) => b.title);
  const canon = resolveCanonical(
    canonicalCriteria({ recipesDir, recipe: "saas-crud" }),
    () => null,
    [contact],
    () => ({ file: "tests/e2e/contacts.spec.ts", titles }),
    new Set(["open-sign-up"]),
  );

  it("links every generated CRUD function of the entity to its generated test, which proves the wording", () => {
    const ids = canon.map((c) => c.id);
    for (const id of [
      "saas-crud.crud-create:Contact",
      "saas-crud.crud-list:Contact",
      "saas-crud.crud-edit:Contact",
      "saas-crud.crud-delete:Contact",
      "saas-crud.csv-export:Contact",
      "saas-crud.search:Contact",
      "saas-crud.csv-import:Contact",
      "saas-crud.tenant-isolation:Contact",
    ])
      expect(ids).toContain(id);
    for (const c of canon) {
      const { title } = splitTestRef(c.tests[0] as string);
      const block = testBlocks(spec).find((b) => b.title === title);
      expect(block, c.id).toBeDefined();
      expect(proofVerdict(c.criterion, block as never).proven, `${c.id}: ${c.criterion}`).toBe(
        true,
      );
    }
  });

  it.each([
    ["Users can add a new contact with name and email", "saas-crud.crud-create:Contact"],
    ["The owner can delete a contact", "saas-crud.crud-delete:Contact"],
    ["Contacts can be exported to a CSV file", "saas-crud.csv-export:Contact"],
    ["Search contacts by name", "saas-crud.search:Contact"],
    ["Users can edit a contact's details", "saas-crud.crud-edit:Contact"],
  ])("maps %j", (asked, id) => {
    expect(mapToCanonical(asked, canon).map((c) => c.id)).toContain(id);
  });

  it("never claims a function the generated screens do not have", () => {
    expect(mapToCanonical("Contacts are synced with HubSpot every hour", canon)).toEqual([]);
    expect(mapToCanonical("A member can delete a contact", canon)).toEqual([]);
  });

  it("drops the tenant-isolation criterion where sign-up is staff-only", () => {
    const staff = resolveCanonical(
      canonicalCriteria({ recipesDir, recipe: "saas-crud" }),
      () => null,
      ["Contact"],
      () => ({ file: "tests/e2e/contacts.spec.ts", titles }),
      new Set(),
    );
    expect(staff.map((c) => c.id)).not.toContain("saas-crud.tenant-isolation:Contact");
  });
});

/** A recipe as a build installs it: the chain's templates (most specific first) and its required components' files. */
const recipeCanon = (recipe: string, extra: string[] = []) =>
  resolveCanonical(
    canonicalCriteria({ recipesDir, recipe }),
    sourceIn(
      join(recipesDir, recipe, "template"),
      join(recipesDir, "saas-crud", "template"),
      ...extra,
    ),
  );

describe("canonical criteria: tracker", () => {
  it.each([
    ["Users can quickly log the amount of a tracker for today", ["tracker.quick-logging"]],
    ["Each habit shows the current streak of consecutive days", ["tracker.streaks"]],
    ["The user sets a daily goal for each tracker", ["tracker.goals"]],
    ["The tracker shows the weekly total of the last 7 days", ["tracker.weekly-totals"]],
    ["A 30-day history shows which days met the goal", ["tracker.history"]],
  ])("maps %j", (asked, ids) => {
    expect(mapToCanonical(asked, recipeCanon("tracker")).map((c) => c.id)).toEqual(ids);
  });
  it.each([
    "The app syncs steps automatically from a smartwatch",
    "Users get a push notification reminder every evening",
  ])("keeps %j out", (asked) => {
    expect(mapToCanonical(asked, recipeCanon("tracker"))).toEqual([]);
  });
});

describe("canonical criteria: projects", () => {
  it.each([
    ["Team members move tasks between columns on a Kanban board", ["projects.kanban"]],
    ["Each task has a priority (low, medium, high, urgent)", ["projects.priorities"]],
    ["Tasks past their due date are flagged as overdue", ["projects.due-dates"]],
    ["Users can add comments on a task", ["projects.comments"]],
    ["Each member sees a personal list of the tasks assigned to them", ["projects.my-tasks"]],
  ])("maps %j", (asked, ids) => {
    expect(mapToCanonical(asked, recipeCanon("projects")).map((c) => c.id)).toEqual(ids);
  });
  it.each([
    "Team members log time spent on each task with a timer",
    "Tasks sync with GitHub issues",
  ])("keeps %j out", (asked) => {
    expect(mapToCanonical(asked, recipeCanon("projects"))).toEqual([]);
  });
});

describe("canonical criteria: storefront", () => {
  it.each([
    ["Shoppers add products to a cart and change the quantity", ["storefront.cart"]],
    ["Customers pay by card with Stripe Checkout", ["storefront.checkout"]],
    ["Customers apply a discount code at checkout", ["storefront.discount-codes"]],
    ["Products have size and colour variants with their own SKU", ["storefront.variants"]],
    ["Shoppers search products by name", ["storefront.search"]],
  ])("maps %j", (asked, ids) => {
    expect(mapToCanonical(asked, recipeCanon("storefront")).map((c) => c.id)).toEqual(ids);
  });
  it.each([
    "Customers pay later in instalments with Klarna",
    "Shoppers leave product reviews with star ratings",
  ])("keeps %j out", (asked) => {
    expect(mapToCanonical(asked, recipeCanon("storefront"))).toEqual([]);
  });
});

describe("canonical criteria: booking assistant (AI apps)", () => {
  const ai = () =>
    resolveCanonical(
      canonicalCriteria({
        recipesDir,
        recipe: "ai-agents",
        components: ["domain.bookings.turbineh"],
      }),
      sourceIn(
        join(recipesDir, "ai-agents", "template"),
        join(recipesDir, "saas-crud", "template"),
        join(componentsDir, "domain.bookings.turbineh", "files"),
        join(componentsDir, "domain.bookings.turbineh", "files-ai"),
      ),
    );
  it("resolves every assistant criterion when its tests are in the package", () => {
    const ids = ai().map((c) => c.id);
    for (const id of [
      "bookings.assistant-books",
      "bookings.assistant-reschedule",
      "bookings.assistant-cancel-notice",
      "bookings.assistant-prices",
      "bookings.assistant-find-by-email",
      "bookings.assistant-injection",
      "bookings.assistant-input-limit",
    ])
      expect(ids).toContain(id);
  });
  it.each([
    [
      "A customer can book an appointment by chatting with the AI assistant",
      ["bookings.assistant-books"],
    ],
    [
      "The assistant reschedules a booking to a new slot after the customer confirms",
      ["bookings.assistant-reschedule"],
    ],
    [
      "The chatbot answers questions about the price of each service",
      ["bookings.assistant-prices"],
    ],
    ["Prompt injection attempts are rejected by the assistant", ["bookings.assistant-injection"]],
  ])("maps %j", (asked, ids) => {
    expect(mapToCanonical(asked, ai()).map((c) => c.id)).toEqual(ids);
  });
  it("keeps a voice-call assistant out", () => {
    expect(mapToCanonical("Customers book by phone call with a voice assistant", ai())).toEqual([]);
  });
});

// Staging dry run 2026-10-16 (bench/validation A01/B01, PR #121): both flows read "verified" at 7/11 and 3/5 with
// criteria the bookings tests prove. Each request criterion, with this app's aliases from src/bookings/params.json.
describe("canonical criteria: staging regression A01 / B01 (ADR-0063)", () => {
  const A01 = ["groomer", "groomers", "Paws & Suds", "salon", "Bath", "Full groom", "Nail trim"];
  const B01 = ["instructor", "instructors", "Pilates Norte", "studio", "Private class"];
  it.each([
    [
      A01,
      "Given a customer selects a 'bath' service, when they pick a time, the system reserves a 40-minute slot.",
      "bookings.public-booking",
    ],
    [
      A01,
      "Given a customer selects a 'full groom' service, when they pick a time, the system reserves a 90-minute slot.",
      "bookings.public-booking",
    ],
    [
      A01,
      "Given a customer selects 'any groomer', when they book, the system assigns the first available groomer for that time.",
      "bookings.public-booking",
    ],
    [
      A01,
      "Given a customer completes a booking without an account, when the booking is processed, a confirmation email is sent containing a cancellation link.",
      "bookings.confirmation-email",
    ],
    [
      A01,
      "Given a customer clicks the cancellation link, when the current time is more than 12 hours before the appointment, the booking is successfully cancelled.",
      "bookings.cancel-notice",
    ],
    [
      A01,
      "Given a customer clicks the cancellation link, when the current time is less than 12 hours before the appointment, the cancellation is denied.",
      "bookings.cancel-notice",
    ],
    [
      A01,
      "Given a groomer logs in, when they view their calendar, they can toggle between daily and weekly views.",
      "bookings.staff-calendar",
    ],
    [
      A01,
      "Given a groomer uses the calendar, when they block a day off, no appointments can be scheduled for that groomer on that date.",
      "bookings.time-off",
    ],
    [
      A01,
      "Given a groomer manages the calendar, when they move or cancel an appointment, a notification email is automatically sent to the customer.",
      "bookings.staff-move-cancel",
    ],
    [
      A01,
      "Given a booking attempt is made, when the selected time slot is already occupied for the chosen groomer, the system prevents the booking.",
      "bookings.no-double-booking",
    ],
    [
      B01,
      "A client can successfully book a 55-minute private class by selecting a specific instructor and an available time slot.",
      "bookings.public-booking",
    ],
    [
      B01,
      "A client receives a confirmation email immediately after a successful booking.",
      "bookings.confirmation-email",
    ],
    [
      B01,
      "A client can cancel a booking through the app interface if the cancellation occurs more than 24 hours before the class start time.",
      "bookings.cancel-notice",
    ],
    [
      B01,
      "An instructor can view their personal schedule via a calendar interface.",
      "bookings.staff-calendar",
    ],
    [
      B01,
      "An instructor can mark specific dates as 'days off' to prevent bookings on those dates.",
      "bookings.time-off",
    ],
  ])("maps %#: %s", (aliases, asked, id) => {
    expect(mapToCanonical(asked, bookings(), aliases).map((c) => c.id)).toEqual([id]);
  });
  it("keeps the WhatsApp parts of B01 out", () => {
    for (const asked of [
      "Every client gets an automatic WhatsApp reminder 24 hours before the class",
      "A client can cancel by replying CANCEL to the WhatsApp reminder",
    ])
      expect(mapToCanonical(asked, bookings(), B01)).toEqual([]);
  });
});

/** A recipe's canonical criteria as a build of it installs them (recipe chain + required components' files). */
const installed = (recipe: string, ai = false) =>
  resolveCanonical(
    canonicalCriteria({ recipesDir, recipe }),
    sourceIn(
      join(recipesDir, recipe, "template"),
      join(recipesDir, "saas-crud", "template"),
      ...(ai
        ? ["ai.orchestrator.turbineh", "security.ai-safety.turbineh"].flatMap((id) => [
            join(componentsDir, id, "files"),
            join(componentsDir, id, "files-ai"),
          ])
        : []),
    ),
  );

describe("canonical criteria · landing-waitlist (ADR-0063)", () => {
  it.each([
    [
      "A visitor can join the waitlist by entering their name and email on the landing page",
      "landing-waitlist.join",
    ],
    [
      "After signing up, the visitor receives a confirmation email",
      "landing-waitlist.confirmation-email",
    ],
    [
      "The admin can see the list of everyone who joined the waitlist in a dashboard",
      "landing-waitlist.admin-signups",
    ],
    [
      "The landing page explains the benefits, how it works and answers frequently asked questions",
      "landing-waitlist.landing-page",
    ],
  ])("maps %j to %s", (asked, id) => {
    expect(mapToCanonical(asked, installed("landing-waitlist")).map((c) => c.id)).toEqual([id]);
  });
  it.each([
    "Visitors who refer three friends move up the waitlist",
    "The admin can send a launch announcement email to everyone on the waitlist",
  ])("keeps %j out", (asked) => {
    expect(mapToCanonical(asked, installed("landing-waitlist"))).toEqual([]);
  });
});

describe("canonical criteria · corporate-site (ADR-0063)", () => {
  it.each([
    [
      "A visitor can fill in the contact form and gets a confirmation message",
      "corporate-site.contact-form",
    ],
    [
      "The admin can publish blog posts that appear on the blog and in the RSS feed",
      "corporate-site.blog",
    ],
    ["The owner can read contact messages in the dashboard", "corporate-site.messages"],
    [
      "The admin can edit the home page headline from the admin panel",
      "corporate-site.edit-content",
    ],
  ])("maps %j to %s", (asked, id) => {
    expect(mapToCanonical(asked, installed("corporate-site")).map((c) => c.id)).toEqual([id]);
  });
  it.each([
    "Visitors can switch the website between English and Spanish",
    "Visitors can book a meeting from the contact page",
  ])("keeps %j out", (asked) => {
    expect(mapToCanonical(asked, installed("corporate-site"))).toEqual([]);
  });
});

describe("canonical criteria · client-portal (ADR-0063)", () => {
  it.each([
    ["A client can submit a request with a title and description", "client-portal.submit-request"],
    ["Clients can upload PDF files to their request", "client-portal.file-uploads"],
    ["A client can follow the status of their requests", "client-portal.follow-status"],
    ["Staff can review client requests and update their status", "client-portal.staff-review"],
  ])("maps %j to %s", (asked, id) => {
    expect(mapToCanonical(asked, installed("client-portal")).map((c) => c.id)).toEqual([id]);
  });
  it.each([
    "Clients can pay their invoices online by card",
    "Staff can chat with the client in real time on each request",
  ])("keeps %j out", (asked) => {
    expect(mapToCanonical(asked, installed("client-portal"))).toEqual([]);
  });
});

describe("canonical criteria · analytics-dashboard (ADR-0063)", () => {
  it.each([
    ["The user can import data from a CSV file", "analytics-dashboard.csv-import"],
    ["The owner can enter a value manually", "analytics-dashboard.manual-entry"],
    [
      "KPIs show the change compared with the previous period",
      "analytics-dashboard.period-comparison",
    ],
    [
      "The dashboard can be filtered by category and the data exported as CSV",
      "analytics-dashboard.filter-export",
    ],
  ])("maps %j to %s", (asked, id) => {
    expect(mapToCanonical(asked, installed("analytics-dashboard")).map((c) => c.id)).toEqual([id]);
  });
  it.each([
    "Data is synced automatically every hour from Google Analytics",
    "The dashboard forecasts next month's revenue with machine learning",
  ])("keeps %j out", (asked) => {
    expect(mapToCanonical(asked, installed("analytics-dashboard"))).toEqual([]);
  });
});

describe("canonical criteria · ai-agents (ADR-0063)", () => {
  it.each([
    ["The admin can add documents to the knowledge base", "ai-agents.knowledge-base"],
    [
      "The assistant answers customer questions using the knowledge base documents",
      "ai-agents.chat-over-documents",
    ],
    ["Support tickets are classified in batch into labels", "ai-agents.batch-classify"],
    ["A prompt injection attempt is refused with a safe message", "ai-agents.safety"],
    ["The admin can see AI usage and the audit trail", "ai-agents.usage-audit"],
  ])("maps %j to %s", (asked, id) => {
    expect(mapToCanonical(asked, installed("ai-agents", true)).map((c) => c.id)).toEqual([id]);
  });
  it.each([
    "The assistant answers customers on WhatsApp",
    "The assistant generates images for marketing posts",
  ])("keeps %j out", (asked) => {
    expect(mapToCanonical(asked, installed("ai-agents", true))).toEqual([]);
  });
});

describe("domain components' canonical criteria prove their own wording (ADR-0063)", () => {
  it.each([
    "domain.membership-access.turbineh",
    "domain.workflow.turbineh",
    "domain.audit-log.turbineh",
    "domain.bookings.turbineh",
  ])("%s", (id) => {
    const list = canonicalCriteria({ recipesDir, recipe: "saas-crud", components: [id] }).filter(
      (c) => c.from === id && !c.when,
    );
    expect(list.length).toBeGreaterThan(0);
    const source = sourceIn(join(componentsDir, id, "files"));
    const resolved = resolveCanonical(list, source);
    expect(resolved.map((c) => c.id)).toEqual(list.map((c) => c.id));
    for (const c of resolved) {
      const proven = c.tests.some((t) => {
        const { file, title } = splitTestRef(t);
        const block = testBlocks(source(file) ?? "").find((b) => b.title === title);
        return block !== undefined && proofVerdict(c.criterion, block).proven;
      });
      expect(proven, c.id).toBe(true);
      expect(mapToCanonical(c.criterion, resolved).map((m) => m.id)).toContain(c.id);
    }
  });
});
