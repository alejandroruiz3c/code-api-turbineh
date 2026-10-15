import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildSpec } from "@turbineh/compiler";
import { openDecider, type Decider } from "@turbineh/decider";
import { detectStack, isGapNotice } from "@turbineh/engine";
import { describe, expect, it } from "vitest";
import { componentPlan, flowPlan } from "./product.js";
import { coveredPart, gateRequest, withScope } from "./scope.js";

const componentsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../catalog/components");

const decider = (outside = false): Decider => ({
  ...openDecider,
  scopeOutside: async (input) => ({
    outside: Object.fromEntries(input.requirements.map((r) => [r.index, outside])),
    meta: { model: "fake", latencyMs: 1 },
  }),
});

const spec = (over: Partial<BuildSpec>): BuildSpec =>
  ({
    recipe: "saas-crud",
    out_of_scope_reason: null,
    closest_recipe: null,
    app_name: "AutoPublish Social",
    slug: "autopublish-social",
    summary: "Publishes posts",
    roles: ["admin"],
    entities: [{ name: "Post", fields: [{ name: "title", type: "string", required: true }] }],
    pages: [{ path: "/posts", purpose: "Posts", auth_required: true }],
    capabilities: [],
    acceptance_criteria: [],
    site: null,
    palette: null,
    ...over,
  }) as unknown as BuildSpec;

describe("scope gate in the worker (ADR-0052), against the real catalogue", () => {
  it('refuses "autonomous social media publisher with AI drafts and scheduled publishing" before generation', async () => {
    const need = "autonomous social media publisher with AI drafts and scheduled publishing";
    for (const recipe of ["out_of_scope", "saas-crud"] as const) {
      const v = await gateRequest({
        prompt: need,
        spec: spec({
          recipe,
          acceptance_criteria: [
            "Users connect their Instagram and LinkedIn accounts",
            "AI drafts a post from a topic",
            "Scheduled posts are published automatically to the connected social accounts",
            "Users can edit a draft before it is scheduled",
          ],
        }),
        componentsDir,
        decider: decider(),
      });
      expect(v.status, recipe).toBe("uncovered");
      expect(v.notCovered.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("a covered recipe passes; an uncovered requirement makes it partial, built only by explicit choice", async () => {
    const criteria = [
      "Clients book an available slot",
      "Staff see appointments in a calendar",
      "Clients get a confirmation email",
    ];
    const covered = await gateRequest({
      prompt: "Bookings for a physiotherapy clinic",
      spec: spec({
        recipe: "bookings",
        app_name: "Physio Bookings",
        acceptance_criteria: criteria,
      }),
      componentsDir,
      decider: decider(),
    });
    expect(covered.status).toBe("covered");

    const s = spec({
      recipe: "bookings",
      app_name: "Physio Bookings",
      acceptance_criteria: [...criteria, "Each booking is posted to the clinic's Slack channel"],
    });
    const partial = await gateRequest({
      prompt: "Bookings for a physiotherapy clinic",
      spec: s,
      componentsDir,
      decider: decider(),
    });
    expect(partial.status).toBe("partial");
    const trimmed = coveredPart(s, partial);
    expect(trimmed.app_name).toBe("Physio Bookings (covered part only)");
    expect(trimmed.acceptance_criteria).toEqual(criteria);

    const plan = withScope(
      flowPlan({
        buildId: "b-partial",
        request: {
          need: "Bookings",
          stack: detectStack({ stack: { language: "TypeScript", framework: "Next.js" } }),
        },
        slug: "physio",
        recipeId: "bookings",
        selected: {},
        decisions: [],
        gaps: [],
        templateDeps: {},
        templateEnv: "",
        componentsDir,
        entities: [],
        labels: (c) => c,
      }),
      partial,
      s.app_name,
    );
    expect(plan.scope?.status).toBe("partial");
    expect(plan.scope?.removed.map((r) => r.requirement)).toEqual([
      "Each booking is posted to the clinic's Slack channel",
    ]);
    // The explicit choice comes first and is never auto-approved (`turbineh build` stops with exit 3).
    expect(plan.needsApproval[0]).toMatch(
      /^Build only the covered part, "Physio Bookings \(covered part only\)"/,
    );
    expect(isGapNotice(plan.needsApproval[0] ?? "")).toBe(false);
    expect(plan.outcome?.actions[0]?.label).toBe("Build only the covered part");
    // Removed requirements are never presented as work left or as configuration.
    expect(JSON.stringify(plan.left)).not.toContain("Slack");
    expect(JSON.stringify(plan.config)).not.toContain("Slack");
  });

  it("explicit components: exactly those are planned, covered without inferring anything", async () => {
    const ids = ["files.qr.qrcode"];
    const v = await gateRequest({
      prompt: "autonomous social media publisher",
      spec: spec({ recipe: "out_of_scope" }),
      componentsDir,
      decider: decider(true),
      explicit: ids,
    });
    expect(v.status).toBe("covered");
    expect(v.via).toBe("components");
    const plan = componentPlan(
      "b-explicit",
      {
        need: "autonomous social media publisher with AI drafts",
        stack: detectStack({ stack: { language: "TypeScript", framework: "Next.js" } }),
      },
      componentsDir,
      ids,
    );
    expect(plan.components.map((c) => c.id)).toEqual(ids);
    expect(plan.components[0]?.why).toMatch(/Chosen by you/);
  });
});
