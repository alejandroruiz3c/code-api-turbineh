import { openDecider, type Decider } from "@turbineh/decider";
import { CAPABILITY_LABELS } from "@turbineh/selector";
import { describe, expect, it } from "vitest";
import { justifyCapabilities } from "./relevance.js";

/** Annex A/B of the external audit: the social-media publisher's criteria and the 39 capabilities its plan decided. */
const CRITERIA = [
  "With a connected LinkedIn account, when a post is generated, the content respects the character limits and format of LinkedIn",
  "With a brand voice profile, when a draft is generated, the tone follows the brand guidelines",
  "With a topic calendar, when the scheduler runs, it generates drafts on those topics",
  "With human approval on, the post stays in Draft until it is approved manually",
  "At the scheduled time, the system tries to publish on the configured networks",
  "When publishing fails, the system retries according to the retry policy",
  "Every publishing attempt creates a log entry with the time and the status",
  "In the panel, the user sees the calendar and the list of published posts",
  "In the panel, when there is interaction data, basic metrics (likes, shares) are shown",
];
const PLANNED = [
  "jobs.scheduler",
  "ops.retry",
  "observability.logging",
  "ui.calendar",
  "ui.charts",
  "data.yaml",
  "files.image-processing",
  "ai.text-chunking",
  "payments.checkout",
  "payments.subscriptions",
  "ai.token-count",
  "ai.prompt-templates",
  "ops.queue-throttle",
  "ui.icons",
  "ui.tooltip",
  "ui.scroll-area",
  "ui.progress",
  "ui.alert-dialog",
  "ui.menu",
  "ui.virtual-list",
  "data.serialization",
  "ops.http-client",
  "files.type-detection",
  "ui.notifications",
  "ui.styling",
];
const input = {
  summary: "Autonomous social media publisher",
  prompt:
    "An autonomous social media publisher for LinkedIn, Instagram, Facebook and X with AI drafts in our brand voice.",
  criteria: CRITERIA,
  capabilities: PLANNED,
  recipe: { id: "ai-agents", useCase: ["ai.orchestrator", "security.ai-safety"], transversal: {} },
  required: { "ai.orchestrator": "ai.orchestrator.turbineh" },
  evidence: {},
  nonFunctional: [],
  label: (c: string) => CAPABILITY_LABELS[c] ?? c,
};

describe("relevance (ADR-0064, audit Annex A)", () => {
  it("open rules: what the criteria ask for stays, with the criterion; the rest is listed as not selected", async () => {
    const r = await justifyCapabilities(input, openDecider);
    for (const c of ["jobs.scheduler", "ops.retry", "observability.logging", "ui.calendar"])
      expect(r.justified[c]?.[0]?.kind, c).toBe("criterion");
    for (const c of [
      "data.yaml",
      "files.image-processing",
      "ai.text-chunking",
      "payments.checkout",
      "payments.subscriptions",
      "ui.icons",
    ])
      expect(
        r.notSelected.map((n) => n.capability),
        c,
      ).toContain(c);
    expect(r.justified["ai.orchestrator"]).toEqual([{ kind: "use_case", ref: "ai-agents" }]);
  });

  it("the decision engine's answer wins and cites the criterion it chose", async () => {
    const engine: Pick<Decider, "capabilityRelevance"> = {
      capabilityRelevance: async (q) => ({
        justified: Object.fromEntries(
          q.capabilities.map((c) => [
            c.id,
            {
              by: c.id === "ui.charts" ? { kind: "criterion" as const, index: 8 } : null,
              confidence: 0.9,
            },
          ]),
        ),
        meta: { model: "m", latencyMs: 1 },
      }),
    };
    const r = await justifyCapabilities(input, engine);
    expect(r.via).toBe("decider");
    expect(r.justified["ui.charts"]).toEqual([{ kind: "criterion", ref: CRITERIA[8] }]);
    expect(r.justified["ops.retry"]).toBeUndefined();
  });
});
