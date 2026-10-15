import { buildPlan, detectStack, flowOutcome, planScope, USE_CASES } from "@turbineh/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
