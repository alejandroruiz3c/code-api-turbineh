import type { BuildRow } from "@turbineh/db";
import {
  COMPONENTS_ONLY_APPROVAL,
  componentOffer,
  componentsOnlyApproval,
  notCoveredExplanation,
  notCoveredReason,
  offerComponents,
  planScope,
  type OfferEntry,
} from "@turbineh/engine";
import type { Plan, ScopeRequirement } from "@turbineh/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPONENTS_ONLY_APPROVAL as WEB_PREFIX } from "@/components/not-covered";

/**
 * Route tests (ADR-0062): POST /v1/plans answers an uncovered use case with a components-only offer (a plan that needs
 * approval) when verified components serve part of it, or 422 `use_case_not_covered` with the explanation when none
 * does; partially covered plans and explicit components are unchanged. POST /v1/plans/{id}/generate builds the offer
 * only with {"approve": true}; POST /v1/builds forwards `components_only`.
 */

const rows = new Map<string, BuildRow>();
const enqueued: Record<string, unknown>[] = [];
let nextRow: (id: string) => BuildRow;

vi.mock("@turbineh/db", async (orig) => ({
  ...(await orig<typeof import("@turbineh/db")>()),
  buildsLastDay: async () => 0,
  buildsLastDayFromIp: async () => 0,
  costToday: async () => ({ eur: 0 }),
  approvedCatalog: async () => [
    { id: "jobs.scheduled.turbineh", provides: ["jobs.scheduled"], docs: null },
  ],
  enqueueBuild: async (_db: unknown, input: Record<string, unknown>) => {
    enqueued.push(input);
    const id = `00000000-0000-4000-8000-00000000000${enqueued.length}`;
    rows.set(id, nextRow(id));
    return { id, created: true };
  },
  getBuild: async (_db: unknown, id: string) => rows.get(id) ?? null,
  requeueForGeneration: async () => true,
}));
vi.mock("@/server/caller", () => ({
  getCaller: async () => ({ kind: "api-key", ownerId: "api:test", apiKeyId: "k", dailyQuota: 50 }),
}));
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/server/env", () => ({
  env: {
    USER_DAILY_BUILDS: 10,
    IP_DAILY_BUILDS: 30,
    DAILY_COST_CAP_EUR: 100,
    BETTER_AUTH_SECRET: "x".repeat(32),
  },
}));
vi.mock("@/server/storage", () => ({ storage: { url: async (k: string) => `/files/${k}` } }));
vi.mock("@/server/demand-email", () => ({ confirmDemandLater: () => undefined }));
vi.mock("@/server/github", () => ({
  workspaceGitHub: async () => ({ connected: false, gh: null }),
}));
vi.mock("@/server/plan-decider", () => ({ planDecider: () => null }));

const plans = await import("./route");
const generate = await import("./[id]/generate/route");
const builds = await import("../builds/route");

const NEED = "autonomous social media publisher with AI drafts and scheduled publishing";
const notCovered: ScopeRequirement[] = [
  {
    requirement: "autonomous social media publisher (the use case itself)",
    covered: false,
    why: "Autonomous actions without a person's confirmation: not part of any verified use case",
  },
  {
    requirement: "Scheduled posts are published to the connected social accounts",
    covered: false,
    why: "Integration with social media: no verified component connects to it yet",
  },
];
const verdict = { status: "uncovered", requirements: notCovered, notCovered };
const CATALOG: OfferEntry[] = [
  {
    id: "ai.orchestrator.turbineh",
    version: "1.0.0",
    category: "ai",
    provides: ["ai.orchestrator"],
    license: "Apache-2.0",
    purl: "pkg:generic/turbineh/ai.orchestrator@1.0.0",
    does: "Every AI call of the app is orchestrated by TurbineH",
    acceptance: [
      { test: "tests/unit/ai-agent.test.ts › runs read tools, then answers", covers: ["tools"] },
    ],
  },
];
/** The decision engine confirming the code's candidates (the core is blocked: code alone offers nothing). */
const confirm = {
  componentsServe: async (input: {
    requirements: { index: number; candidates: { id: string }[] }[];
  }) => ({
    serves: Object.fromEntries(
      input.requirements.map((r) => [r.index, r.candidates.map((c) => c.id)]),
    ),
    meta: { model: "fake", latencyMs: 1 },
  }),
};

const row = (id: string, over: Partial<BuildRow>): BuildRow =>
  ({
    id,
    status: "queued",
    prompt: NEED,
    owner_id: "api:test",
    options: { mode: "plan" },
    metrics: {},
    artifact: null,
    error: null,
    spec: null,
    created_at: new Date().toISOString(),
    finished_at: null,
    ...over,
  }) as unknown as BuildRow;

const basePlan = (id: string, over: Partial<Plan> = {}): Plan =>
  ({
    id,
    need: NEED,
    state: "planned",
    stack: { language: "typescript", framework: "nextjs", source: "declared", versions: {} },
    capability: {
      id: "c",
      kind: "component",
      name: "c",
      summary: "",
      components: 1,
      stacks: [],
      requirements: [],
      example: "",
    },
    components: [
      { id: "jobs.scheduled.turbineh", version: "1.0.0", license: "Apache-2.0", why: "w" },
    ],
    compatible: true,
    incompatibilities: [],
    missing: [],
    decisions: [],
    files: [],
    dependencies: [],
    config: [],
    estimate: { seconds: 1, costUsd: 0, tokens: 0, newLinesToMaintain: 0 },
    needsApproval: [],
    ...over,
  }) as Plan;

async function offerPlanRow(id: string): Promise<BuildRow> {
  const result = await offerComponents(
    {
      need: NEED,
      verdict: {
        requirements: [
          ...notCovered,
          {
            requirement: "AI drafts a post from a topic",
            covered: false,
            why: "AI generation: this use case includes no AI and no verified AI component was chosen",
          },
        ],
        notCovered,
      },
      catalog: CATALOG,
    },
    confirm,
  );
  const offer = componentOffer(result!, { need: NEED, planId: id });
  const explanation = notCoveredExplanation({ need: NEED, notCovered, offer });
  const plan = basePlan(id, {
    needsApproval: [componentsOnlyApproval(offer)],
    scope: {
      status: "components_only",
      useCase: "components",
      name: offer.name,
      removed: offer.outOfScope,
      message: "m",
      explanation,
    },
  });
  return row(id, { status: "done", metrics: { plan, scopeGate: verdict } });
}

const post = (url: string, body: unknown) =>
  new Request(`https://x${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  rows.clear();
  enqueued.length = 0;
});

describe("POST /v1/plans · uncovered use case (ADR-0062)", () => {
  it("useful components → 200 with the components-only offer, which needs approval", async () => {
    nextRow = () => row("pending", {});
    const pending = plans.POST(post("/v1/plans", { need: NEED }));
    // The worker finishes the plan while the route waits.
    const id = "00000000-0000-4000-8000-000000000001";
    await vi.waitFor(() => expect(rows.has(id)).toBe(true));
    rows.set(id, await offerPlanRow(id));
    const res = await pending;
    expect(res.status).toBe(200);
    const body = (await res.json()) as Plan & {
      offer: {
        title: string;
        notIncluded: string;
        components: { id: string; proof: { test: string }[] }[];
      };
    };
    expect(body.scope?.status).toBe("components_only");
    expect(body.offer.title).toMatch(
      /^Verified components for your request “autonomous social media publisher”/,
    );
    expect(body.offer.components.map((c) => c.id)).toEqual(["ai.orchestrator.turbineh"]);
    expect(body.offer.components[0]?.proof[0]?.test).toMatch(/then answers/);
    expect(body.offer.notIncluded).toMatch(/^Not included — the core of your request/);
    expect(body.scope?.explanation?.priority).toMatch(/notify you with priority/);
    expect(body.needsApproval[0]?.startsWith(COMPONENTS_ONLY_APPROVAL)).toBe(true);
    // The web detects the same choice.
    expect(WEB_PREFIX).toBe(COMPONENTS_ONLY_APPROVAL);
  });

  it("nothing useful → 422 use_case_not_covered with the explanation (why, priority notice, what we can do now)", async () => {
    nextRow = (id) =>
      row(id, {
        status: "failed",
        error: notCoveredReason(verdict),
        metrics: {
          scopeGate: verdict,
          explanation: notCoveredExplanation({ need: NEED, notCovered, offer: null }),
        },
      });
    const res = await plans.POST(post("/v1/plans", { need: NEED }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      notCovered: string[];
      explanation: {
        notCovered: ScopeRequirement[];
        priority: string;
        canDoNow: string;
        offer: null;
      };
    };
    expect(body.code).toBe("use_case_not_covered");
    // The flow id, so agents can reference the refused request.
    expect((body as unknown as { id: string }).id).toBe("00000000-0000-4000-8000-000000000001");
    expect(body.notCovered).toHaveLength(2);
    expect(body.explanation.notCovered[1]?.why).toMatch(/social media/);
    expect(body.explanation.priority).toMatch(/priority/);
    expect(body.explanation.canDoNow).toMatch(/nothing was built/);
    expect(body.explanation.offer).toBeNull();
  });

  it("partially covered (unchanged): a plan whose first decision is the covered part", async () => {
    const { scope, approval } = planScope(
      {
        status: "partial",
        via: "use_case",
        useCase: "bookings",
        requirements: [],
        notCovered,
        decider: null,
      },
      "Physio Bookings",
    );
    nextRow = (id) =>
      row(id, {
        status: "done",
        metrics: { plan: basePlan(id, { scope, needsApproval: [approval ?? ""] }) },
      });
    const res = await plans.POST(
      post("/v1/plans", { need: "Physio bookings synced to Google Calendar" }),
    );
    const body = (await res.json()) as Plan & { offer: unknown };
    expect(res.status).toBe(200);
    expect(body.scope?.status).toBe("partial");
    expect(body.offer).toBeNull();
    expect(body.needsApproval[0]).toMatch(/^Build only the covered part/);
  });

  it("explicit components (unchanged): exactly those are planned", async () => {
    nextRow = (id) => row(id, { status: "done", metrics: { plan: basePlan(id) } });
    const res = await plans.POST(
      post("/v1/plans", {
        need: "scheduled jobs for my app",
        components: ["jobs.scheduled.turbineh"],
      }),
    );
    expect(res.status).toBe(200);
    expect((enqueued[0]?.options as { plan: { components: string[] } }).plan.components).toEqual([
      "jobs.scheduled.turbineh",
    ]);
    const unknown = await plans.POST(
      post("/v1/plans", { need: "scheduled jobs", components: ["nope"] }),
    );
    expect(unknown.status).toBe(422);
  });
});

describe("approving the offer", () => {
  it('POST /v1/plans/{id}/generate builds it only with {"approve": true}', async () => {
    const id = "00000000-0000-4000-8000-0000000000aa";
    rows.set(id, await offerPlanRow(id));
    const ctx = { params: Promise.resolve({ id }) };
    const refused = await generate.POST(post(`/v1/plans/${id}/generate`, {}), ctx);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { code: string }).code).toBe("needs_approval");
    const ok = await generate.POST(post(`/v1/plans/${id}/generate`, { approve: true }), ctx);
    expect(ok.status).toBe(202);
  });

  it("POST /v1/builds forwards components_only (direct builds)", async () => {
    nextRow = (id) => row(id, {});
    const res = await builds.POST(post("/v1/builds", { prompt: NEED, components_only: true }));
    expect(res.status).toBe(202);
    expect((enqueued[0]?.options as Record<string, unknown>).components_only).toBe(true);
    // Never through `options` (reserved, like covered_only).
    await builds.POST(post("/v1/builds", { prompt: NEED, options: { components_only: true } }));
    expect((enqueued[1]?.options as Record<string, unknown>).components_only).toBeUndefined();
  });
});
