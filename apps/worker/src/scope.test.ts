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
      // Connecting and publishing are covered by the social.* components (ADR-0067); autonomy and AI drafts in a
      // use case without AI are not.
      const why = v.notCovered.map((r) => r.why);
      expect(why).toContain(
        "Autonomous actions without a person's confirmation: not part of any verified use case",
      );
      expect(why.some((w) => w.startsWith("AI generation"))).toBe(true);
      expect(why.filter((w) => w.startsWith("Integration with"))).toEqual([]);
    }
  });

  it("social publishing with approval on LinkedIn, Facebook, Instagram and X is covered by the social components (ADR-0067)", async () => {
    const v = await gateRequest({
      prompt:
        "A social media publisher for a small bakery: connects LinkedIn, Instagram, Facebook and X accounts; the owner approves each post before it is published; posts are scheduled and published at the chosen time, retried on failure and logged; a calendar and basic engagement metrics.",
      spec: spec({
        acceptance_criteria: [
          "The owner connects LinkedIn, Instagram, Facebook and X accounts",
          "Each post is approved before it is published",
          "Scheduled posts are published to LinkedIn and X at the chosen time",
          "Failed publications are retried and every publication is logged",
          "A dashboard shows likes and comments of published posts on Instagram and Facebook",
        ],
      }),
      componentsDir,
      decider: decider(),
    });
    expect(v.notCovered).toEqual([]);
    expect(v.status).toBe("covered");
  });

  it("networks no component connects to stay uncovered (TikTok), and so does the audit's autonomous publisher", async () => {
    const tiktok = await gateRequest({
      prompt: "Publish our videos to TikTok and YouTube every Friday",
      spec: spec({ acceptance_criteria: ["Videos are published to TikTok every Friday"] }),
      componentsDir,
      decider: decider(),
    });
    expect(tiktok.status).toBe("uncovered");
    expect(tiktok.notCovered.map((r) => r.why)).toContain(
      "Integration with TikTok: no verified component connects to it yet",
    );
    const audit = await gateRequest({
      prompt:
        "An autonomous social media publisher for a small business: connects LinkedIn, Instagram, Facebook and X accounts; generates post drafts with AI from a brand voice and a content calendar (topics, frequency per network); adapts each post to each network's format and length; optional human approval before publishing; schedules and publishes automatically at the configured times; retries on failure and logs every publication; dashboard with the calendar, published posts and basic engagement metrics.",
      spec: spec({
        recipe: "ai-agents",
        acceptance_criteria: ["Posts are published to LinkedIn at the configured times"],
      }),
      componentsDir,
      decider: decider(),
    });
    expect(audit.status).toBe("uncovered");
    expect(audit.notCovered.map((r) => r.why)).toContain(
      "Autonomous actions without a person's confirmation: not part of any verified use case",
    );
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
