import { buildPlan, detectStack, USE_CASES } from "@turbineh/engine";
import { DELIVERY_SCHEMA, type DeliveryManifest } from "@turbineh/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanReview } from "./plan-review";

const delivery: DeliveryManifest = {
  schema: DELIVERY_SCHEMA,
  recipe: "bookings",
  approved: true,
  entries: [],
  criteria: [],
  env: {
    required: [
      { name: "DATABASE_URL", about: "PostgreSQL" },
      { name: "BETTER_AUTH_SECRET", about: "" },
      { name: "BETTER_AUTH_URL", about: "" },
    ],
    optional: [{ name: "TRUSTED_PROXY_HOPS", about: "Optional: proxies" }],
  },
  notSelected: [
    {
      capability: "data.yaml",
      label: "YAML reading and writing",
      reason: "No requirement asks for it",
    },
  ],
  brokenPromises: [],
};

describe("plan screen · settings from the single env schema (ADR-0064, F-11)", () => {
  const plan = buildPlan({
    id: "p1",
    need: "Physio bookings",
    slug: "physio",
    stack: detectStack({ stack: { language: "TypeScript", framework: "Next.js" } }),
    useCase: USE_CASES.find((u) => u.id === "bookings") ?? null,
    components: [],
    gaps: [],
    decisions: [],
    dependencies: [],
    delivery,
  });
  const html = renderToStaticMarkup(
    <PlanReview plan={plan} approved={{}} onApprove={() => undefined} onAction={() => undefined} />,
  );

  it("shows required (BETTER_AUTH_* included) and optional settings apart", () => {
    const required = html.slice(
      html.indexOf('data-testid="settings-required"'),
      html.indexOf('data-testid="settings-optional"'),
    );
    expect(required).toContain("BETTER_AUTH_SECRET");
    expect(required).toContain("BETTER_AUTH_URL");
    expect(required).not.toContain("TRUSTED_PROXY_HOPS");
    expect(html.slice(html.indexOf('data-testid="settings-optional"'))).toContain(
      "TRUSTED_PROXY_HOPS",
    );
  });

  it("lists what was left out because the request does not ask for it", () => {
    expect(html).toContain("YAML reading and writing");
  });
});
