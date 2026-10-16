import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildSpec } from "@turbineh/compiler";
import { openDecider, type Decider } from "@turbineh/decider";
import { detectStack, isGapNotice } from "@turbineh/engine";
import { describe, expect, it } from "vitest";
import { componentPlan, flowPlan } from "./product.js";
import { coveredPart, explainUncovered, gateRequest, offerPlan, withScope } from "./scope.js";

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

describe("uncovered use case → components-only offer (ADR-0062), against the real catalogue", () => {
  const need = "autonomous social media publisher with AI drafts and scheduled publishing";
  const criteria = [
    "Users sign in with email and password",
    "Users connect their Instagram and LinkedIn accounts",
    "AI drafts a post from a topic",
    "Scheduled posts are published automatically to the connected social accounts",
  ];
  const gate = () =>
    gateRequest({
      prompt: need,
      spec: spec({ recipe: "out_of_scope", acceptance_criteria: criteria }),
      componentsDir,
      decider: decider(),
    });
  const confirmAll: Decider = {
    ...openDecider,
    componentsServe: async (input) => ({
      serves: Object.fromEntries(
        input.requirements.map((r) => [r.index, r.candidates.map((c) => c.id)]),
      ),
      meta: { model: "fake", latencyMs: 1 },
    }),
  };

  it("owner's example: only the AI drafting, proved by a verified test; the core is said not to be included", async () => {
    const verdict = await gate();
    expect(verdict.status).toBe("uncovered");
    // The open engine has no judgement and the core (publishing to social networks) is blocked: no offer.
    const open = await explainUncovered({
      prompt: need,
      verdict,
      componentsDir,
      decider: openDecider,
      planId: "p",
    });
    expect(open.explanation.offer).toBeNull();
    expect(open.explanation.canDoNow).toMatch(/nothing is offered/);

    const { explanation, result } = await explainUncovered({
      prompt: need,
      verdict,
      componentsDir,
      decider: confirmAll,
      planId: "plan-1",
    });
    expect(result?.decidedBy).toBe("decider");
    const offer = explanation.offer;
    // Never the scheduler (it cannot publish anywhere) nor sign-in (not asked for by the person).
    expect(offer?.components.map((c) => c.id)).toEqual([
      "ai.orchestrator.turbineh",
      "security.ai-safety.turbineh",
    ]);
    expect(offer?.components[0]?.serves).toEqual(["AI drafts a post from a topic"]);
    expect(offer?.components[0]?.proof[0]?.test).toMatch(/ai-agent\.test\.ts/);
    expect(offer?.coreNotIncluded).toBe(true);
    expect(offer?.notIncluded).toMatch(
      /^Not included — the core of your request: “autonomous social media publisher”/,
    );
    expect(offer?.youGet).toMatch(/^You get AI generation through the TurbineH orchestrator/);

    // The plan: exactly those components, the explicit choice first, never the use case.
    const plan = offerPlan(
      "plan-1",
      { need, stack: detectStack({ stack: { language: "TypeScript", framework: "Next.js" } }) },
      componentsDir,
      explanation,
    );
    expect(plan.capability.kind).toBe("component");
    expect(plan.capability.name).toBe(offer?.name);
    expect(plan.components.map((c) => c.id).sort()).toEqual([
      "ai.orchestrator.turbineh",
      "security.ai-safety.turbineh",
    ]);
    expect(plan.scope?.status).toBe("components_only");
    expect(plan.scope?.removed).toEqual(offer?.outOfScope);
    expect(plan.needsApproval[0]).toMatch(/^Build verified components only, /);
    expect(isGapNotice(plan.needsApproval[0] ?? "")).toBe(false);
    expect(plan.components.find((c) => c.id === "ai.orchestrator.turbineh")?.why).toMatch(
      /^Gives AI generation .* for: AI drafts a post from a topic — proved by tests\/unit\/ai-agent/,
    );
    expect(plan.outcome?.title).toBe(offer?.title);
    expect(plan.outcome?.meaning).toContain(offer?.notIncluded ?? "");
    expect(plan.outcome?.actions.map((a) => a.id)).not.toContain("build_nextjs_app");
    expect(plan.outcome?.actions[0]?.label).toBe("Build the verified components");
  });

  it("the decision engine can only narrow: when it confirms nothing, nothing is offered", async () => {
    const verdict = await gate();
    const none: Decider = {
      ...openDecider,
      componentsServe: async (input) => ({
        serves: Object.fromEntries(input.requirements.map((r) => [r.index, ["data.ids.uuid"]])),
        meta: { model: "fake", latencyMs: 1 },
      }),
    };
    const { explanation } = await explainUncovered({
      prompt: need,
      verdict,
      componentsDir,
      decider: none,
      planId: null,
    });
    expect(explanation.offer).toBeNull();
  });

  it("nothing useful → no offer: the refusal and the priority notice stand", async () => {
    const prompt = "A native iOS app: a racing video game played over Bluetooth";
    const verdict = await gateRequest({
      prompt,
      spec: spec({
        recipe: "out_of_scope",
        acceptance_criteria: ["Players race each other over Bluetooth"],
      }),
      componentsDir,
      decider: decider(),
    });
    expect(verdict.status).toBe("uncovered");
    const { explanation } = await explainUncovered({
      prompt,
      verdict,
      componentsDir,
      decider: confirmAll,
      planId: "p",
    });
    expect(explanation.offer).toBeNull();
    expect(explanation.canDoNow).toMatch(/nothing was built/);
  });
});
