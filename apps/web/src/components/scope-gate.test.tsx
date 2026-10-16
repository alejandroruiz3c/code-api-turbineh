import { buildPlan, detectStack, flowOutcome, planScope, USE_CASES } from "@turbineh/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMPONENTS_ONLY_APPROVAL, NotCovered } from "./not-covered";
import { PlanReview } from "./plan-review";
import { badgeOf, STATE_LABEL } from "./ui";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

describe("plan screen · partially covered request (ADR-0052)", () => {
  const plan = buildPlan({
    id: "p1",
    need: "Physio bookings synced to Google Calendar",
    slug: "physio",
    stack: detectStack({ stack: { language: "TypeScript", framework: "Next.js" } }),
    useCase: USE_CASES.find((u) => u.id === "bookings") ?? null,
    components: [],
    gaps: [],
    decisions: [],
    dependencies: [],
  });
  const { scope, approval } = planScope(
    {
      status: "partial",
      via: "use_case",
      useCase: "bookings",
      requirements: [],
      notCovered: [
        {
          requirement: "Every booking is synced to Google Calendar",
          covered: false,
          why: "Integration with Google Calendar: no verified component connects to it yet",
        },
      ],
      decider: null,
    },
    "Physio Bookings",
  );
  plan.scope = scope;
  plan.needsApproval = [approval ?? "", ...plan.needsApproval];

  it("lists what is removed from scope before generating, and asks for the explicit choice", () => {
    const html = renderToStaticMarkup(
      <PlanReview plan={plan} approved={{}} onApprove={() => {}} onAction={() => {}} />,
    );
    const t = text(html);
    expect(html).toContain('data-testid="scope-removed"');
    expect(t).toContain("The library doesn't cover this use case yet.");
    expect(t).toContain("Every booking is synced to Google Calendar");
    expect(t).toContain("Physio Bookings (covered part only)");
    // The choice is a checkbox under "Needs your approval"; nothing is shown as configuration or as work left.
    expect(t).toMatch(/Needs your approval[\s\S]*Build only the covered part/);
    expect(t).not.toMatch(/What is left after generation[\s\S]*Google Calendar/);
  });
});

describe("state badge · checks and requirements apart (F18)", () => {
  const row = {
    id: "b",
    status: "done",
    options: {},
    metrics: {
      verify: [{ name: "build", ok: true }],
      handover: { checksPassed: 11, checksTotal: 11 },
      acceptance: { met: 6, covered: 0, open: ["a", "b"] },
    },
    artifact: { zipKey: "k" },
    error: null,
  };

  it('reads "Checks 11/11 · Requirements 6/8 met", never "Package verified"', () => {
    const b = badgeOf(flowOutcome(row));
    expect(b.label).toBe("Checks 11/11 · Requirements 6/8 met");
    expect(STATE_LABEL.verified.label).not.toMatch(/verified/i);
    expect(
      badgeOf(
        flowOutcome({
          ...row,
          status: "failed",
          metrics: { ...row.metrics, delivery: { kind: "unverified" } },
        }),
      ).label,
    ).toMatch(/^(Not verified|Delivered, not verified)/);
  });
});

describe("uncovered use case · explanation and components-only offer (ADR-0062)", () => {
  const explanation = {
    title: "The library doesn't cover this use case yet",
    useCase: "autonomous social media publisher",
    notCovered: [
      {
        requirement: "Scheduled posts are published to the connected social accounts",
        covered: false,
        why: "Integration with social media: no verified component connects to it yet",
      },
    ],
    priority:
      "We recorded your request and will notify you with priority as soon as the library covers it.",
    canDoNow: "We can prepare a components-only package now.",
    offer: {
      kind: "components_only" as const,
      title:
        "Verified components for your autonomous social media publisher: ai.orchestrator.turbineh",
      name: "Verified components for autonomous social media publisher",
      youGet: "You get AI generation through the TurbineH orchestrator — working and verified.",
      notIncluded:
        "Not included — the core of your request: autonomous social media publisher itself.",
      coreNotIncluded: true,
      components: [
        {
          id: "ai.orchestrator.turbineh",
          does: "Every AI call is orchestrated",
          gives: "AI generation through the TurbineH orchestrator",
          serves: ["AI drafts a post from a topic"],
          proof: [
            {
              requirement: "AI drafts a post from a topic",
              test: "tests/unit/ai-agent.test.ts › runs read tools, then answers",
            },
          ],
        },
      ],
      outOfScope: [
        {
          requirement: "Scheduled posts are published to the connected social accounts",
          covered: false,
          why: "x",
        },
      ],
      approve: { web: "w", api: "a", cli: "c", mcp: "m" },
    },
  };

  it("says what is not covered and why, the priority notice, what you get, what is not included and the evidence", () => {
    const t = text(
      renderToStaticMarkup(
        <NotCovered explanation={explanation} action={<button>Build</button>} />,
      ),
    );
    expect(t).toContain("The library doesn't cover this use case yet");
    expect(t).toContain("Integration with social media: no verified component connects to it yet");
    expect(t).toContain("notify you with priority");
    expect(t).toContain("You get AI generation through the TurbineH orchestrator");
    expect(t).toContain("Not included — the core of your request");
    expect(t).toContain("Proved by: tests/unit/ai-agent.test.ts › runs read tools, then answers");
    expect(t).toContain("Build");
  });

  it("the plan screen shows the offer with its own button, not as a checkbox", () => {
    const plan = buildPlan({
      id: "p2",
      need: "autonomous social media publisher",
      slug: "x",
      stack: detectStack({ stack: { language: "TypeScript", framework: "Next.js" } }),
      useCase: null,
      components: [],
      gaps: [],
      decisions: [],
      dependencies: [],
    });
    plan.scope = {
      status: "components_only",
      useCase: "components",
      name: explanation.offer.name,
      removed: explanation.offer.outOfScope,
      message: "m",
      explanation,
    };
    plan.needsApproval = [`${COMPONENTS_ONLY_APPROVAL}"x": …`];
    const html = renderToStaticMarkup(
      <PlanReview plan={plan} approved={{}} onApprove={() => {}} onAction={() => {}} />,
    );
    expect(html).toContain('data-action="build_components"');
    expect(html).toContain('data-testid="component-offer"');
    expect(text(html)).not.toMatch(/Needs your approval/);
  });
});
