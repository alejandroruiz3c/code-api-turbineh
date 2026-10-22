import { openDecider, type Decider } from "@turbineh/decider";
import { describe, expect, it } from "vitest";
import { ERRORS } from "./errors.js";
import { explainFailure } from "./messages.js";
import { isGapNotice } from "./plan.js";
import { appQuickstart, checksAndRequirements, flowOutcome, flowResult } from "./result.js";
import {
  COVERED_PART_APPROVAL,
  NOT_COVERED_MESSAGE,
  notCoveredReason,
  planScope,
  asksForAi,
  scopeGate,
  uncoveredByCode,
  type GateComponent,
} from "./scope-gate.js";

/** A decider whose engine answers every open requirement with a fixed "needs something outside" verdict. */
function fakeDecider(outside: (requirement: string) => boolean): Decider & { calls: number } {
  const d = {
    ...openDecider,
    calls: 0,
    async scopeOutside(input: Parameters<Decider["scopeOutside"]>[0]) {
      d.calls++;
      return {
        outside: Object.fromEntries(input.requirements.map((r) => [r.index, outside(r.text)])),
        meta: { model: "fake", latencyMs: 1 },
      };
    },
  };
  return d;
}

const CATALOG: GateComponent[] = [
  {
    id: "ui.calendar.turbineh",
    provides: ["ui.calendar"],
    does: "Calendar views with time slots",
  },
  {
    id: "email.resend",
    provides: ["email.transactional"],
    does: "Transactional email (confirmations, reminders)",
  },
  {
    id: "jobs.scheduler.turbineh",
    provides: ["jobs.scheduler"],
    does: "Runs jobs at scheduled times",
  },
  {
    id: "auth.better-auth",
    provides: ["auth.session", "auth.oauth"],
    does: "Sign-in with email or with Google and GitHub",
  },
];

const BOOKINGS = {
  id: "bookings",
  description: "Booking or appointment app: availability, calendar slots and notifications",
};

describe("scope gate (ADR-0052)", () => {
  it("a covered recipe: every requirement covered, one batched decider request", async () => {
    const decider = fakeDecider(() => false);
    const v = await scopeGate(
      {
        need: "Bookings for a physiotherapy clinic with reminder emails",
        requirements: [
          "Clients book an available 45-minute slot",
          "Staff see the week's appointments in a calendar",
          "Clients receive a reminder email the day before",
        ],
        useCase: BOOKINGS,
        catalog: CATALOG,
        provenByTests: new Set(["Clients book an available 45-minute slot"]),
        aiIncluded: false,
      },
      decider,
    );
    expect(v.status).toBe("covered");
    expect(v.via).toBe("use_case");
    expect(v.notCovered).toEqual([]);
    expect(decider.calls).toBe(1);
    expect(v.requirements[0]?.why).toMatch(/test shipped/);
  });

  it("N-05 (ADR-0063): a detailed request where no requirement maps to a verified function is refused", async () => {
    // The decider would place every requirement "inside the use case": the functional floor still refuses it.
    const v = await scopeGate(
      {
        need: "AutoPublish Social: a SaaS where brands schedule content and see engagement analytics per post",
        requirements: [
          "Brands schedule content for each campaign with per-network limits",
          "Engagement analytics per post are shown after publication",
          "Drafts are approved by a brand manager before they go live",
        ],
        useCase: {
          id: "saas-crud",
          description: "Multi-tenant SaaS with sign-in, workspaces, roles and CRUD screens",
        },
        catalog: CATALOG,
        provenByTests: new Set(),
        aiIncluded: false,
      },
      fakeDecider(() => false),
    );
    expect(v.status).toBe("uncovered");
    expect(v.via).toBe("none");
    expect(v.notCovered).toHaveLength(3);
    expect(v.notCovered[0]?.why).toMatch(/0 % functional coverage/);
  });

  it("N-05: one requirement on a verified function is enough to pass the floor", async () => {
    const v = await scopeGate(
      {
        need: "Bookings for a physiotherapy clinic",
        requirements: [
          "Clients book an available 45-minute slot",
          "Staff see the week in a calendar",
        ],
        useCase: BOOKINGS,
        catalog: CATALOG,
        provenByTests: new Set(["Clients book an available 45-minute slot"]),
        aiIncluded: false,
      },
      fakeDecider(() => false),
    );
    expect(v.status).toBe("covered");
  });

  it("components chosen explicitly are covered as they were verified, without asking the decider", async () => {
    const decider = fakeDecider(() => true);
    const v = await scopeGate(
      {
        need: "autonomous social media publisher",
        requirements: ["Posts are published to Instagram automatically"],
        useCase: null,
        catalog: CATALOG,
        explicitComponents: ["ui.calendar.turbineh", "jobs.scheduler.turbineh"],
        aiIncluded: false,
      },
      decider,
    );
    expect(v.status).toBe("covered");
    expect(v.via).toBe("components");
    expect(decider.calls).toBe(0);
  });

  const SOCIAL = {
    need: "autonomous social media publisher with AI drafts and scheduled publishing",
    requirements: [
      "Users connect their Instagram and LinkedIn accounts",
      "AI drafts a post from a topic the user enters",
      "Scheduled posts are published automatically to the connected social accounts",
      "Users can create, edit and delete post drafts",
    ],
  };

  it("the audit case is refused, whatever family the decider picked: nothing is built on saas-crud", async () => {
    for (const useCase of [
      null,
      { id: "saas-crud", description: "Multi-user SaaS with CRUD screens" },
    ]) {
      const v = await scopeGate(
        { ...SOCIAL, useCase, catalog: CATALOG, aiIncluded: false },
        fakeDecider(() => false),
      );
      expect(v.status, useCase?.id ?? "out_of_scope").toBe("uncovered");
      const why = v.notCovered.map((r) => r.why).join(" | ");
      expect(why).toMatch(/Integration with Instagram/);
      expect(why).toMatch(/AI generation/);
      expect(why).toMatch(/Autonomous actions|Integration with social media/);
      // The headline counts too: it names the use case, checked by code, not only the compiled criteria.
      expect(v.notCovered[v.notCovered.length - 1]?.requirement).toBe(
        "autonomous social media publisher (the use case itself)",
      );
    }
  });

  it("an uncovered headline refuses the request even when every compiled criterion looks covered", async () => {
    const v = await scopeGate(
      {
        need: SOCIAL.need,
        requirements: ["Users can create post drafts", "Users see a calendar of scheduled posts"],
        useCase: { id: "saas-crud", description: "Multi-user SaaS with CRUD screens" },
        catalog: CATALOG,
        aiIncluded: false,
      },
      fakeDecider(() => false),
    );
    expect(v.status).toBe("uncovered");
    expect(v.notCovered.map((r) => r.requirement)).toEqual([
      "autonomous social media publisher (the use case itself)",
      "AI drafts (stated in the request)",
    ]);
  });

  it("a specification that excludes an integration is not refused for it", async () => {
    const v = await scopeGate(
      {
        need: "Bookings for a clinic. Out of scope: syncing with Google Calendar.",
        requirements: ["Clients book an available slot", "Staff see appointments"],
        useCase: BOOKINGS,
        catalog: CATALOG,
        aiIncluded: false,
      },
      fakeDecider(() => false),
    );
    expect(v.status).toBe("covered");
  });

  it("partial: a covered use case with one uncovered requirement offers the covered part as an explicit choice", async () => {
    const v = await scopeGate(
      {
        need: "Physio bookings",
        requirements: [
          "Clients book an available slot",
          "Staff see appointments in a calendar",
          "Clients receive a reminder email",
          "Every booking is synced to the clinic's Google Calendar",
        ],
        useCase: BOOKINGS,
        catalog: CATALOG,
        aiIncluded: false,
      },
      fakeDecider(() => false),
    );
    expect(v.status).toBe("partial");
    expect(v.notCovered.map((r) => r.requirement)).toEqual([
      "Every booking is synced to the clinic's Google Calendar",
    ]);
    const { scope, approval } = planScope(v, "Physio Bookings");
    expect(scope.status).toBe("partial");
    expect(scope.name).toBe("Physio Bookings (covered part only)");
    expect(scope.message.startsWith(NOT_COVERED_MESSAGE)).toBe(true);
    // A person must choose it: never auto-approved like a gap notice.
    expect(approval?.startsWith(COVERED_PART_APPROVAL)).toBe(true);
    expect(isGapNotice(approval ?? "")).toBe(false);
  });

  it("the decision engine decides requirements code cannot place", async () => {
    const v = await scopeGate(
      {
        need: "Shop",
        requirements: [
          "Customers pay",
          "Prices update from the supplier's ERP every hour",
          "Orders",
        ],
        useCase: { id: "storefront", description: "Online shop" },
        catalog: CATALOG,
        aiIncluded: false,
      },
      fakeDecider((r) => r.includes("ERP")),
    );
    expect(v.status).toBe("partial");
    expect(v.notCovered[0]?.requirement).toMatch(/ERP/);
  });

  it("without a decider answer: covered use case keeps its requirements, no use case refuses", async () => {
    const failing = {
      ...fakeDecider(() => false),
      scopeOutside: () => Promise.reject(new Error("down")),
    } satisfies Decider;
    const base = {
      need: "x",
      requirements: ["Staff see appointments"],
      catalog: CATALOG,
      aiIncluded: false,
    };
    expect((await scopeGate({ ...base, useCase: BOOKINGS }, failing)).status).toBe("covered");
    expect((await scopeGate({ ...base, useCase: null }, failing)).status).toBe("uncovered");
  });

  it("code checks avoid false positives: data fields, links, people acting for others, catalogue integrations", () => {
    const ctx = { catalog: CATALOG, aiIncluded: false };
    expect(uncoveredByCode("Clients have an Instagram handle on their profile", ctx)).toBeNull();
    expect(uncoveredByCode("The footer shows links to our LinkedIn and Instagram", ctx)).toBeNull();
    expect(uncoveredByCode("Staff can book an appointment on the client's behalf", ctx)).toBeNull();
    expect(uncoveredByCode("Clients can book without approval from staff", ctx)).toBeNull();
    expect(uncoveredByCode("Users sign in with Google", ctx)).toBeNull();
    expect(uncoveredByCode("A weekly reminder email is sent at 9:00", ctx)).toBeNull();
    expect(
      uncoveredByCode("An AI assistant answers questions", { ...ctx, aiIncluded: true }),
    ).toBeNull();
    expect(uncoveredByCode("Send a WhatsApp message when a booking is confirmed", ctx)).toMatch(
      /WhatsApp/,
    );
    expect(uncoveredByCode("An iOS app for clients", ctx)).toMatch(/native mobile app/);
  });
});

describe("SMS and WhatsApp notifications (ADR-0070)", () => {
  const MESSAGING: GateComponent[] = [
    ...CATALOG,
    {
      id: "messaging.sms.twilio",
      provides: ["messaging.sms"],
      does: "Sends SMS text messages with Twilio",
    },
    {
      id: "messaging.whatsapp.meta",
      provides: ["messaging.whatsapp"],
      does: "Sends WhatsApp notifications as approved templates",
    },
  ];
  const ctx = { catalog: MESSAGING, aiIncluded: false };

  it("sending SMS or WhatsApp to people is covered once a verified component sends on that channel", () => {
    expect(
      uncoveredByCode("Send a WhatsApp reminder to the patient 24 hours before", ctx),
    ).toBeNull();
    expect(uncoveredByCode("Clients get an SMS reminder the day before", ctx)).toBeNull();
    expect(uncoveredByCode("Patients can reply STOP to stop the reminders by SMS", ctx)).toBeNull();
  });

  it("a conversation or a bot on WhatsApp or SMS stays not covered: the components only send notifications", () => {
    expect(
      uncoveredByCode("The assistant answers customer questions by sending WhatsApp messages", ctx),
    ).toMatch(/^Integration with WhatsApp conversations/);
    expect(
      uncoveredByCode("A chatbot that sends answers to customer questions by SMS", ctx),
    ).toMatch(/^Integration with SMS conversations/);
    expect(uncoveredByCode("Customers receive their booking updates on Telegram", ctx)).toMatch(
      /Telegram/,
    );
  });
});

describe("use_case_not_covered: the same message on the web, the API and the CLI", () => {
  it("the worker's reason maps to the owner's sentence with the requirements listed", () => {
    const raw = notCoveredReason({
      notCovered: [
        { requirement: "AI drafts a post", covered: false, why: "AI generation" },
        { requirement: "Publish to Instagram | LinkedIn", covered: false, why: "Integration" },
      ],
    });
    const p = explainFailure(raw, { id: "b1" });
    expect(p.code).toBe("use_case_not_covered");
    expect(p.message).toBe(
      "The library doesn't cover this use case yet. We'll notify you with priority as soon as it does.",
    );
    expect(p.notCovered).toEqual(["AI drafts a post", "Publish to Instagram LinkedIn"]);
    expect(p.next.kind).toBe("new_flow");
    const result = flowResult(
      {
        id: "b1",
        status: "failed",
        options: { mode: "plan" },
        metrics: {},
        artifact: null,
        error: raw,
      },
      { zipUrl: null, manifestUrl: null },
    );
    expect(result.errors[0]?.code).toBe("use_case_not_covered");
    expect(result.errors[0]?.notCovered).toHaveLength(2);
    expect(ERRORS.outOfScope(["x"]).code).toBe("use_case_not_covered");
  });
});

describe("F18 · checks and requirements apart", () => {
  const row = (acceptance: { met: number; covered: number; open: string[] }) => ({
    id: "b2",
    status: "done",
    options: {},
    metrics: {
      verify: Array.from({ length: 11 }, (_, i) => ({ name: `c${i}`, ok: true })),
      handover: { checksPassed: 11, checksTotal: 11 },
      acceptance,
    },
    artifact: { zipKey: "k" },
    error: null,
  });

  it('ADR-0063: "Technically verified · checks 11/11 · functional 6/8" below 80 %, never "verified" alone', () => {
    const r = row({ met: 6, covered: 0, open: ["a", "b"] });
    expect(checksAndRequirements(r).badge).toBe(
      "Technically verified · checks 11/11 · functional 6/8",
    );
    const o = flowOutcome(r);
    expect(o.badge).toBe("Technically verified · checks 11/11 · functional 6/8");
    expect(o.functional).toEqual({ met: 6, total: 8, ratio: 0.75, threshold: 0.8 });
    expect(o.title).toMatch(/^Technically verified · functional 6\/8/);
    expect(o.title).toMatch(/2 not met yet/);
  });

  it('ADR-0063: at or above 80 % the verdict is "Verified", still with its functional coverage', () => {
    const most = flowOutcome(row({ met: 8, covered: 0, open: ["a", "b"] }));
    expect(most.badge).toBe("Verified · checks 11/11 · functional 8/10");
    const all = flowOutcome(row({ met: 8, covered: 0, open: [] }));
    expect(all.badge).toBe("Verified · checks 11/11 · functional 8/8");
    expect(all.title).toMatch(
      /^Verified · functional 8\/8 — .*every one of the 8 requirement\(s\)/,
    );
  });

  it("ADR-0063: 0 % never reads verified; a failed gate reads not verified", () => {
    expect(flowOutcome(row({ met: 0, covered: 0, open: ["a", "b", "c"] })).badge).toBe(
      "Technically verified · checks 11/11 · functional 0/3",
    );
  });
});

describe("F20 · quickstart from the real package", () => {
  it("uses the app's scripts and the root .env.example; no db:seed when the template has none", () => {
    const q = appQuickstart({
      slug: "shop",
      files: ["package.json", ".env.example", "scripts/migrate.ts"],
      scripts: {
        dev: "tsx scripts/local-db.ts --run --migrate -- next dev",
        "db:migrate": "tsx scripts/local-db.ts --run -- tsx scripts/migrate.ts",
      },
    }).join("\n");
    expect(q).toContain("cp .env.example .env.local");
    expect(q).not.toContain("config/.env.example");
    expect(q).not.toContain("db:seed");
    expect(q).toContain("pnpm dev");
    expect(
      appQuickstart({
        slug: "x",
        files: ["package.json"],
        scripts: { dev: "next dev", "db:seed": "s" },
      }),
    ).toContain("pnpm db:seed");
  });
});

describe("pass with warnings in the badge (ADR-0065)", () => {
  it("never shows a plain pass when a passed check has non-blocking findings left", () => {
    const r = {
      id: "b3",
      status: "done",
      options: {},
      metrics: {
        verify: [
          { name: "static", ok: true },
          { name: "dependencies", ok: true, warnings: 1 },
        ],
        handover: { checksPassed: 11, checksTotal: 11, checksWithWarnings: 1 },
        acceptance: { met: 2, covered: 0, open: ["a", "b", "c"] },
      },
      artifact: { zipKey: "k" },
      error: null,
    };
    // ADR-0063 verdict line, with the warnings kept visible.
    expect(checksAndRequirements(r).badge).toBe(
      "Technically verified · checks 11/11 (1 with warnings) · functional 2/5",
    );
    expect(checksAndRequirements(r).checks).toEqual({ passed: 11, total: 11, warnings: 1 });
  });
});

// ADR-0069: "a blog for sharing AI research insights" is a blog ABOUT AI — publishing content about AI uses no model.
describe("AI as the subject of content is not AI generation", () => {
  it.each([
    "a sleek blog for sharing ai research insights",
    "A newsletter about AI for small business owners",
    "un blog sobre IA y ética para estudiantes",
    "A course website on machine learning with lessons and quizzes",
    "a community site with the latest AI news and events",
  ])("topic: %s", (text) => {
    expect(asksForAi(text)).toBe(false);
    expect(uncoveredByCode(text, { catalog: CATALOG, aiIncluded: false })).toBeNull();
  });

  it.each([
    "AI drafts each post from my notes",
    "a blog with AI-generated summaries of every article",
    "an AI research assistant that answers questions about papers",
    "a news site where an AI summarises each article",
    "the system uses AI to tag photos",
    "a chatbot for our shop",
    "the app drafts replies with AI for me to review",
  ])("function: %s", (text) => {
    expect(asksForAi(text)).toBe(true);
    expect(uncoveredByCode(text, { catalog: CATALOG, aiIncluded: false })).toMatch(/AI generation/);
  });

  it("a blog about AI research is gated like any blog (no AI requirement added)", async () => {
    const verdict = await scopeGate({
      need: "a sleek blog for sharing ai research insights",
      requirements: ["The admin publishes a post that appears on the blog, RSS and sitemap"],
      useCase: { id: "corporate-site", description: "Corporate website with a blog" },
      catalog: CATALOG,
      provenByTests: new Set([
        "The admin publishes a post that appears on the blog, RSS and sitemap",
      ]),
      aiIncluded: false,
    });
    expect(verdict.status).toBe("covered");
    expect(verdict.notCovered).toEqual([]);
  });
});
