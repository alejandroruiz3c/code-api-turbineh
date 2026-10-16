import { openDecider, type Decider, type ServeInput } from "@turbineh/decider";
import type { Plan, ScopeRequirement } from "@turbineh/shared";
import { describe, expect, it } from "vitest";
import {
  candidatesFor,
  COMPONENTS_ONLY_APPROVAL,
  componentOffer,
  componentsOnlyApproval,
  evidenceFor,
  notCoveredExplanation,
  OFFER_HINTS,
  offerComponents,
  PRIORITY_NOTICE,
  type OfferEntry,
} from "./component-offer.js";
import { explainFailure } from "./messages.js";
import { componentsOnlyScope } from "./package.js";
import { isGapNotice } from "./plan.js";
import { checksAndRequirements, flowOutcome, flowResult } from "./result.js";
import { NOT_COVERED_TITLE, notCoveredReason } from "./scope-gate.js";

const entry = (
  id: string,
  provides: string[],
  does: string,
  over: Partial<OfferEntry> = {},
): OfferEntry => ({
  id,
  version: "1.0.0",
  category: provides[0]?.split(".")[0] ?? "x",
  provides,
  license: "MIT",
  purl: `pkg:generic/turbineh/${id}@1.0.0`,
  does,
  ...over,
});

const CATALOG: OfferEntry[] = [
  entry(
    "auth.session.better-auth",
    ["auth.session"],
    "Email/password and OAuth authentication with sessions",
    {
      guarantees: [
        {
          claim: "A person signs up and signs in with a password",
          test: "auth.test.ts › signs in",
        },
      ],
    },
  ),
  entry("jobs.scheduled.turbineh", ["jobs.scheduled"], "Scheduled jobs from the request", {
    acceptance: [
      {
        test: "tests/e2e/scheduled-jobs.spec.ts › a due job runs once per scheduled time",
        covers: ["once|twice|duplicate|idempot"],
      },
    ],
    guarantees: [
      {
        claim: "Each scheduled time of a job runs once",
        test: "tests/e2e/scheduled-jobs.spec.ts › runs once",
      },
    ],
  }),
  entry(
    "ai.orchestrator.turbineh",
    ["ai.orchestrator"],
    "Every AI call of the app is orchestrated by TurbineH",
    {
      requires: ["security.ai-safety.turbineh"],
      acceptance: [
        {
          test: "tests/unit/ai-agent.test.ts › runs read tools, then answers",
          covers: ["\\btools?\\b"],
        },
      ],
    },
  ),
  entry("security.ai-safety.turbineh", ["security.ai-safety"], "AI Safety Pack"),
  entry(
    "payments.checkout.stripe",
    ["payments.checkout"],
    "Stripe checkout sessions and webhooks",
    {
      guarantees: [
        {
          claim: "verifies webhook signatures and rejects forged ones",
          test: "contract.test.ts › verifies webhook signatures",
        },
      ],
    },
  ),
  // A provider of an asked-for function without any test that proves it: never offered.
  entry("files.qr.unproven", ["files.qr"], "QR codes"),
];

const NEED = "autonomous social media publisher with AI drafts and scheduled publishing";

/** The gate's verdict for the owner's example (the compiler added sign-in, the person never asked for it). */
const REQS: ScopeRequirement[] = [
  {
    requirement: "Users connect their Instagram and LinkedIn accounts",
    covered: false,
    why: "Integration with Instagram: no verified component connects to it yet",
  },
  {
    requirement: "AI drafts a post from a topic",
    covered: false,
    why: "AI generation: this use case includes no AI and no verified AI component was chosen",
  },
  {
    requirement: "Scheduled posts are published automatically to the connected social accounts",
    covered: false,
    why: "Integration with social media: no verified component connects to it yet",
  },
  {
    requirement: "Users sign in with email and password",
    covered: true,
    why: "Covered by verified components",
  },
  {
    requirement: "autonomous social media publisher (the use case itself)",
    covered: false,
    why: "Autonomous actions without a person's confirmation: not part of any verified use case",
  },
];
const VERDICT = { requirements: REQS, notCovered: REQS.filter((r) => !r.covered) };

const judging = (
  pick: (text: string, id: string) => boolean,
): Pick<Decider, "componentsServe"> & { inputs: ServeInput[] } => {
  const inputs: ServeInput[] = [];
  return {
    inputs,
    componentsServe: async (input) => {
      inputs.push(input);
      return {
        serves: Object.fromEntries(
          input.requirements.map((r) => [
            r.index,
            // a judge may name anything: only the code's candidates can survive
            [...r.candidates.map((c) => c.id), "data.ids.uuid"].filter((id) => pick(r.text, id)),
          ]),
        ),
        meta: { model: "fake", latencyMs: 1 },
      };
    },
  };
};

const YES = judging(() => true);

describe("components-only offer: only real functions the person asked for (ADR-0062)", () => {
  it("owner's example: AI drafts only; publishing (the core) is blocked, sign-in was never asked for", async () => {
    const r = await offerComponents(
      { need: NEED, verdict: VERDICT, catalog: CATALOG },
      judging(() => true),
    );
    expect(r?.decidedBy).toBe("decider");
    expect(r?.components.map((c) => c.id)).toEqual([
      "ai.orchestrator.turbineh",
      "security.ai-safety.turbineh",
    ]);
    const ai = r?.components[0];
    expect(ai?.serves).toEqual(["AI drafts a post from a topic"]);
    expect(ai?.proof[0]?.test).toBe("tests/unit/ai-agent.test.ts › runs read tools, then answers");
    expect(r?.components[1]?.requiredBy).toBe("ai.orchestrator.turbineh");
    expect(r?.coreNotIncluded).toBe(true);
    // Never offered: the scheduler for "published to the connected social accounts" (it can't publish anywhere),
    // nor sign-in (generic plumbing the person did not ask for).
    expect(r?.outOfScope.map((o) => o.requirement)).toEqual([
      "Users connect their Instagram and LinkedIn accounts",
      "Scheduled posts are published automatically to the connected social accounts",
      "Users sign in with email and password",
      "autonomous social media publisher (the use case itself)",
    ]);
    const offer = componentOffer(r!, { need: NEED, planId: "p1" });
    expect(offer.youGet).toMatch(/^You get AI generation through the TurbineH orchestrator/);
    expect(offer.notIncluded).toBe(
      "Not included — the core of your request: “autonomous social media publisher”, and: Users connect their Instagram and LinkedIn accounts; Scheduled posts are published automatically to the connected social accounts; Users sign in with email and password. This package is not that product.",
    );
  });

  it("negative: generic plumbing, blocked requirements and unproven components are never offered", () => {
    const covered = (requirement: string): ScopeRequirement => ({
      requirement,
      covered: true,
      why: "x",
    });
    // Sign-in asked by the compiler only, not by the person.
    expect(
      candidatesFor(covered("Users sign in"), "A CRM synced with Salesforce", CATALOG),
    ).toEqual([]);
    // Asked, but blocked by an external platform: the scheduler cannot publish to Instagram.
    expect(
      candidatesFor(
        {
          requirement: "Posts are scheduled to Instagram",
          covered: false,
          why: "Integration with Instagram: …",
        },
        "schedule posts to Instagram",
        CATALOG,
      ),
    ).toEqual([]);
    // The use case itself is never matched.
    expect(
      candidatesFor(
        { requirement: "AI scheduler (the use case itself)", covered: false, why: "x" },
        "AI scheduler",
        CATALOG,
      ),
    ).toEqual([]);
    // Missing AI is fixed by the orchestrator only (not by a scheduler that the words also mention).
    expect(
      candidatesFor(
        { requirement: "AI writes a daily summary", covered: false, why: "AI generation: …" },
        "AI writes a daily summary",
        CATALOG,
      ).map((c) => c.entry.id),
    ).toEqual(["ai.orchestrator.turbineh"]);
    // Asked for and provided, but no verified test proves it: not offered.
    expect(
      candidatesFor(covered("Generate a QR code per ticket"), "QR codes for tickets", CATALOG),
    ).toEqual([]);
    // Payments asked by the person and proved by a test: offered.
    const pay = candidatesFor(
      covered("Buyers pay with Stripe"),
      "a marketplace where buyers pay with Stripe",
      CATALOG,
    );
    expect(pay.map((c) => c.entry.id)).toEqual(["payments.checkout.stripe"]);
    expect(pay[0]?.evidence).toMatch(/webhook signatures/);
    // Every hint names a proof pattern and a plain result.
    for (const h of OFFER_HINTS) expect(h.gives.length).toBeGreaterThan(5);
  });

  it("evidence: an acceptance rule matching the requirement first, else a tested guarantee of the function", () => {
    const jobs = CATALOG[1] as OfferEntry;
    const hint = OFFER_HINTS.find((h) => h.provides === "jobs.scheduled")!;
    expect(evidenceFor("A reminder is sent once per scheduled time", jobs, hint)).toBe(
      "tests/e2e/scheduled-jobs.spec.ts › a due job runs once per scheduled time",
    );
    expect(evidenceFor("A report is scheduled every morning", jobs, hint)).toMatch(
      /^Each scheduled time/,
    );
    expect(evidenceFor("x", entry("j", ["jobs.scheduled"], "d"), hint)).toBeNull();
  });

  it("the decision engine confirms with a high bar and can only narrow the code's candidates", async () => {
    const d = judging((_text, id) => id === "data.ids.uuid");
    expect(await offerComponents({ need: NEED, verdict: VERDICT, catalog: CATALOG }, d)).toBeNull();
    expect(d.inputs).toHaveLength(1);
    expect(d.inputs[0]?.requirements).toEqual([
      {
        index: 1,
        text: "AI drafts a post from a topic",
        candidates: [
          {
            id: "ai.orchestrator.turbineh",
            does: "Every AI call of the app is orchestrated by TurbineH",
            evidence: "tests/unit/ai-agent.test.ts › runs read tools, then answers",
          },
        ],
      },
    ]);
    const yes = judging(() => true);
    const r = await offerComponents({ need: NEED, verdict: VERDICT, catalog: CATALOG }, yes);
    expect(r?.decidedBy).toBe("decider");
    expect(r?.components.map((c) => c.id)).toEqual([
      "ai.orchestrator.turbineh",
      "security.ai-safety.turbineh",
    ]);
  });

  it("without an answer (open engine, outage): code offers only where no part is blocked", async () => {
    const shopNeed = "an online shop where buyers pay with Stripe and orders sync to Shopify";
    const shop = {
      requirements: [
        {
          requirement: "Buyers pay with Stripe at checkout",
          covered: true,
          why: "Covered by verified components",
        },
        {
          requirement: "Orders are synced to Shopify",
          covered: false,
          why: "Integration with Shopify: no verified component connects to it yet",
        },
      ],
      notCovered: [],
    };
    const toolNeed = "an internal tool where staff sign in and AI summarizes long reports";
    const tool = {
      requirements: [
        {
          requirement: "Staff sign in with email and password",
          covered: true,
          why: "Covered by verified components",
        },
        {
          requirement: "AI summarizes each report",
          covered: false,
          why: "AI generation: this use case includes no AI and no verified AI component was chosen",
        },
      ],
      notCovered: [],
    };
    for (const decider of [
      null,
      openDecider,
      { componentsServe: async () => Promise.reject(new Error("down")) },
    ]) {
      // The core, or a part, is blocked: no judge → no offer (when in doubt, don't offer).
      expect(
        await offerComponents({ need: NEED, verdict: VERDICT, catalog: CATALOG }, decider),
      ).toBeNull();
      expect(
        await offerComponents({ need: shopNeed, verdict: shop, catalog: CATALOG }, decider),
      ).toBeNull();
      // Nothing blocked, the gap is only "no AI chosen": the explicitly asked, proven functions are offered by code.
      const r = await offerComponents({ need: toolNeed, verdict: tool, catalog: CATALOG }, decider);
      expect(r?.decidedBy).toBe("code");
      expect(r?.coreNotIncluded).toBe(false);
      expect(r?.components.map((c) => c.id)).toEqual([
        "auth.session.better-auth",
        "ai.orchestrator.turbineh",
        "security.ai-safety.turbineh",
      ]);
      expect(componentOffer(r!, { need: toolNeed, planId: null }).notIncluded).toBe(
        "Not included: the application itself (its screens, data and flows) — only these components. This package is not the complete product you described.",
      );
    }
    // With the engine, the shop's payments are offered when it confirms them.
    const judged = await offerComponents({ need: shopNeed, verdict: shop, catalog: CATALOG }, YES);
    expect(judged?.components.map((c) => c.id)).toEqual(["payments.checkout.stripe"]);
    expect(componentOffer(judged!, { need: shopNeed, planId: null }).notIncluded).toBe(
      "Not included: Orders are synced to Shopify; and the application itself (its screens, data and flows) — only these components. This package is not the complete product you described.",
    );
    const game = {
      requirements: [
        {
          requirement: "A native iOS racing game (the use case itself)",
          covered: false,
          why: "It needs a native mobile app",
        },
        {
          requirement: "Players race each other",
          covered: false,
          why: "No verified use case or component covers it",
        },
      ],
      notCovered: [],
    };
    expect(
      await offerComponents(
        { need: "A native iOS racing game", verdict: game, catalog: CATALOG },
        null,
      ),
    ).toBeNull();
  });

  it("explains what is not covered, the priority notice and what we can do now — with or without an offer", async () => {
    const r = await offerComponents({ need: NEED, verdict: VERDICT, catalog: CATALOG }, YES);
    const offer = componentOffer(r!, { need: NEED, planId: "p1" });
    expect(offer.title).toBe(
      "Verified components for your request “autonomous social media publisher”: ai.orchestrator.turbineh",
    );
    expect(offer.approve.api).toBe('POST /v1/plans/p1/generate with {"approve": true}');
    expect(offer.approve.cli).toBe("turbineh resume p1 --approve");
    const e = notCoveredExplanation({ need: NEED, notCovered: VERDICT.notCovered, offer });
    expect(e.title).toBe(NOT_COVERED_TITLE);
    expect(e.useCase).toBe("autonomous social media publisher");
    expect(e.notCovered).toHaveLength(4);
    expect(e.priority).toBe(PRIORITY_NOTICE);
    expect(e.canDoNow).toContain(offer.youGet);
    expect(e.canDoNow).toContain(offer.notIncluded);
    const refused = notCoveredExplanation({
      need: NEED,
      notCovered: VERDICT.notCovered,
      offer: null,
    });
    expect(refused.offer).toBeNull();
    expect(refused.canDoNow).toMatch(/nothing was built and nothing is offered/);
    expect(componentOffer(r!, { need: NEED, planId: null }).approve.api).toMatch(
      /"components_only": true/,
    );
  });

  it("the plan's decision is explicit and never a gap notice (never auto-approved)", async () => {
    const r = await offerComponents({ need: NEED, verdict: VERDICT, catalog: CATALOG }, YES);
    const line = componentsOnlyApproval(componentOffer(r!, { need: NEED, planId: "p1" }));
    expect(line.startsWith(COMPONENTS_ONLY_APPROVAL)).toBe(true);
    expect(line).toMatch(/so it is not built\. You get AI generation/);
    expect(line).toMatch(/the core of your request/);
    expect(isGapNotice(line)).toBe(false);
  });
});

describe("one explanation everywhere (ADR-0062)", () => {
  it("a refused flow carries the explanation stored by the worker (API errors[], CLI, web problem)", async () => {
    const r = await offerComponents({ need: NEED, verdict: VERDICT, catalog: CATALOG }, YES);
    const offer = componentOffer(r!, { need: NEED, planId: null });
    const explanation = notCoveredExplanation({
      need: NEED,
      notCovered: VERDICT.notCovered,
      offer,
    });
    const row = {
      id: "b1",
      status: "failed",
      options: {},
      metrics: { scopeGate: { status: "uncovered", ...VERDICT }, explanation },
      artifact: null,
      error: notCoveredReason(VERDICT),
    };
    const p = explainFailure(row.error, { id: row.id, metrics: row.metrics });
    expect(p.code).toBe("use_case_not_covered");
    expect(p.explanation?.offer?.components.length).toBe(2);
    expect(p.action).toMatch(/components_only/);
    const e = flowResult(row, { zipUrl: null, manifestUrl: null }).errors[0];
    expect(e?.code).toBe("use_case_not_covered");
    expect(e?.explanation?.notCovered[0]?.why).toMatch(/Instagram/);
    expect(e?.notCovered).toHaveLength(4);
    // Rows stored before ADR-0062: the explanation is rebuilt from the gate's verdict, no offer.
    const legacy = explainFailure(row.error, { id: "b0", metrics: { scopeGate: VERDICT } });
    expect(legacy.explanation?.notCovered).toHaveLength(4);
    expect(legacy.explanation?.offer).toBeNull();
    expect(explainFailure(row.error, { id: "b0" }).explanation?.notCovered).toHaveLength(4);
  });

  it("a generated components-only package: honest badge, scope and evidence in its docs, never the use case", async () => {
    const r = await offerComponents({ need: NEED, verdict: VERDICT, catalog: CATALOG }, YES);
    const offer = componentOffer(r!, { need: NEED, planId: "p1" });
    const explanation = notCoveredExplanation({
      need: NEED,
      notCovered: VERDICT.notCovered,
      offer,
    });
    const plan = {
      need: NEED,
      capability: { id: "c", kind: "component", name: offer.name },
      components: [],
      config: [],
      dependencies: [],
      scope: {
        status: "components_only",
        useCase: "components",
        name: offer.name,
        removed: offer.outOfScope,
        message: "m",
        explanation,
      },
    } as unknown as Plan;
    const row = {
      id: "p1",
      status: "done",
      options: { mode: "generate" },
      metrics: {
        plan,
        verify: [
          { name: "contract", ok: true },
          { name: "typecheck", ok: true },
        ],
      },
      artifact: { package: { zipKey: "k" } },
      error: null,
    };
    expect(checksAndRequirements(row).badge).toBe(
      "Checks 2/2 · Requirements 0/5 met · components only: 1 served by a component, 4 out of scope",
    );
    const o = flowOutcome(row);
    expect(o.kind).toBe("package_verified");
    expect(o.meaning).toMatch(/The use case you asked for is not built/);
    expect(flowOutcome({ ...row, options: { components_only: true } }).kind).toBe(
      "package_verified",
    );
    const doc = componentsOnlyScope({ plan });
    expect(doc).toContain("## Scope: verified components only");
    expect(doc).toContain(
      "| `ai.orchestrator.turbineh` | AI generation through the TurbineH orchestrator",
    );
    expect(doc).toContain("tests/unit/ai-agent.test.ts › runs read tools, then answers |");
    expect(doc).toContain("**Not included — the core of your request");
    expect(doc).toContain("- autonomous social media publisher (the use case itself) —");
    expect(componentsOnlyScope({})).toBe("");
  });
});

describe("social components (ADR-0067) in the offer", () => {
  const social: OfferEntry[] = [
    ...CATALOG,
    entry(
      "social.publish.turbineh",
      ["social.publish"],
      "Publishes social media posts to connected accounts",
      {
        requires: ["social.connections.turbineh"],
        acceptance: [
          {
            test: "tests/e2e/social-publish.spec.ts › human approval before publishing: approved posts are published automatically at the scheduled time",
            covers: ["schedul|automatically", "publish|post"],
          },
        ],
      },
    ),
    entry(
      "social.connections.turbineh",
      ["social.oauth"],
      "Connects social media accounts with OAuth 2.0",
    ),
  ];
  const req = (requirement: string): ScopeRequirement => ({
    requirement,
    covered: true,
    why: "Covered by verified components",
  });

  it("the publishing component supersedes a generic scheduler for the same requirement", () => {
    const c = candidatesFor(
      req("Scheduled posts are published automatically to LinkedIn"),
      "schedule posts to LinkedIn",
      social,
    );
    expect(c.map((x) => x.entry.id)).toEqual(["social.publish.turbineh"]);
    expect(c[0]?.hint.gives).toMatch(/never autonomously$/);
  });

  it("negative: no social component for a request that never asks to publish", () => {
    expect(
      candidatesFor(
        req("A report is scheduled every morning"),
        "a daily report every morning",
        social,
      ).map((x) => x.entry.id),
    ).toEqual(["jobs.scheduled.turbineh"]);
    expect(
      candidatesFor(
        req("Show our Instagram handle in the footer"),
        "a site with our Instagram handle",
        social,
      ),
    ).toEqual([]);
  });
});
