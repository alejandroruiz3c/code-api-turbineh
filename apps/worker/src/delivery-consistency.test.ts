/**
 * ADR-0064 (audit F-03/F-11/F-05, Annex A): one source of truth. For every recipe, a plan is rendered from the delivery
 * manifest, the package is assembled (tree-shaken) and finalised with the real document writers — only the sandbox
 * gate is replaced by a passing result — and every surface (plan, plan decisions, result, Next steps, DEPLOY.md,
 * AGENTS.md, turbineh.json) is read back and compared: 0 contradictions. Then the regression of the audit: an approved
 * "written and verified as glue" ops.idempotency that the package does not contain is a broken promise everywhere and
 * the package is never verified.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { assemble, mergedRecipe, recipeChain, type SelectedComponent } from "@turbineh/assembler";
import { ALWAYS_ON, detectDomains } from "@turbineh/compiler";
import { openDecider } from "@turbineh/decider";
import { detectStack } from "@turbineh/engine";
import { CAPABILITY_LABELS } from "@turbineh/selector";
import { decidedComponents, type DeliveryManifest } from "@turbineh/shared";
import type * as Verifier from "@turbineh/verifier";
import type { VerifyResult } from "@turbineh/verifier";
import { loadCatalog } from "./catalog-source.js";
import { checkSpec } from "./combinations.js";
import { deliveryConsistency } from "./consistency.js";
import { finalize } from "./finalize.js";
import { buildManifest, plannedEnv, removedModules } from "./manifest.js";
import { flowPlan } from "./product.js";
import { justifyCapabilities, useCaseCapabilities } from "./relevance.js";

const PASSED: VerifyResult = {
  ok: true,
  steps: ["install", "lint", "typecheck", "unit", "build", "e2e", "secrets", "static"].map(
    (name) => ({
      name,
      ok: true,
      ms: 1,
      detail: "",
    }),
  ) as VerifyResult["steps"],
  findings: { secrets: 0, advisories: [], licenses: [], static: [] },
  scannedAt: "2026-10-16T00:00:00.000Z",
};
vi.mock("@turbineh/verifier", async (importOriginal) => ({
  ...(await importOriginal<typeof Verifier>()),
  verify: vi.fn(async () => PASSED),
}));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const recipesDir = join(repoRoot, "catalog/recipes");
const componentsDir = join(repoRoot, "catalog/components");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Capabilities an intent classification proposes for its own sake (Annex A): no criterion asks for them. */
const UNASKED = [
  "data.yaml",
  "files.image-processing",
  "ai.text-chunking",
  "payments.checkout",
  "ui.icons",
];

interface Case {
  recipe: string;
  prompt: string;
  criteria: string[];
}

const CASES: Case[] = [
  {
    recipe: "saas-crud",
    prompt: "A CRM where my team records clients and their contracts.",
    criteria: [
      "An owner creates a client with a name and an email",
      "Members only see their workspace's clients",
    ],
  },
  {
    recipe: "bookings",
    prompt:
      "Booking site for a physiotherapy clinic: 45-minute sessions, a confirmation email with a cancel link and no double bookings.",
    criteria: [
      "A patient books a 45-minute slot on the public booking page",
      "The patient receives a confirmation email with a cancel link",
      "Two patients cannot book the same slot",
    ],
  },
  {
    recipe: "ai-agents",
    prompt: "An assistant that drafts social media posts with AI for our marketing team.",
    criteria: [
      "A member creates an assistant with instructions",
      "The assistant drafts a post from a topic",
      "Prompt-injection attempts are refused with a safe message",
    ],
  },
  {
    recipe: "storefront",
    prompt: "An online shop for handmade socks with Stripe payments.",
    criteria: ["A shopper adds socks to the cart", "A shopper pays with Stripe Checkout"],
  },
  {
    recipe: "corporate-site",
    prompt: "Website for an architecture studio with a blog and a contact form.",
    criteria: ["A visitor sends a message through the contact form", "Staff publish a blog post"],
  },
  {
    recipe: "landing-waitlist",
    prompt: "A landing page with a waitlist for our app.",
    criteria: ["A visitor joins the waitlist with an email"],
  },
  {
    recipe: "projects",
    prompt: "Project management with kanban boards for a design agency.",
    criteria: ["A member moves a task between columns of the board"],
  },
  {
    recipe: "tracker",
    prompt: "A habit tracker with streaks.",
    criteria: ["A user logs a habit and sees the streak"],
  },
  {
    recipe: "client-portal",
    prompt: "A portal where clients upload documents and follow their requests.",
    criteria: ["A client uploads a file to a request"],
  },
  {
    recipe: "analytics-dashboard",
    prompt: "A dashboard to analyse monthly sales imported from CSV.",
    criteria: [
      "An owner imports sales from a CSV file",
      "The dashboard shows revenue by month in a chart",
    ],
  },
  {
    recipe: "internal-tool",
    prompt: "An internal tool to manage inventory with CSV export.",
    criteria: ["Staff export the inventory as CSV"],
  },
];

/** The pipeline's deterministic path (open decision engine) from a request to a finalised package. */
async function deliver(
  c: Case,
  opts: { extra?: string[]; promise?: (m: DeliveryManifest) => DeliveryManifest } = {},
) {
  const chain = recipeChain(recipesDir, c.recipe);
  const recipe = mergedRecipe(chain);
  const label = (cap: string) =>
    CAPABILITY_LABELS[cap] ?? recipe.modules?.find((m) => m.capability === cap)?.about ?? cap;
  const domains = detectDomains(c.prompt, c.recipe, "Recipe Check");
  const required = {
    ...(recipe.requiredComponents ?? {}),
    ...Object.fromEntries(domains.map((d) => [d.capability, d.component])),
  };
  const moduleCaps = [...new Set((recipe.modules ?? []).map((m) => m.capability))];
  const capabilities = [
    ...new Set([...ALWAYS_ON, ...recipe.defaultCapabilities, ...(opts.extra ?? [])]),
  ];
  const relevance = await justifyCapabilities(
    {
      summary: c.prompt,
      prompt: c.prompt,
      criteria: c.criteria,
      capabilities: [...capabilities, ...moduleCaps],
      recipe: {
        id: c.recipe,
        useCase: useCaseCapabilities(chain),
        transversal: recipe.transversal ?? {},
      },
      required,
      evidence: {},
      nonFunctional: [],
      label,
    },
    openDecider,
  );
  const kept = capabilities.filter((x) => relevance.justified[x]?.length);
  const keptModules = moduleCaps.filter((x) => relevance.justified[x]?.length);
  // Resolution among native components (what the pipeline's policy prefers), required ones by code.
  const catalog = loadCatalog(componentsDir, { cards: "oneliner" });
  // Components the recipe already integrates: native ones and the libraries of its template (better-auth, drizzle…).
  const templatePkg = [...chain]
    .reverse()
    .map((m) => join(recipesDir, m.id, "template/package.json"))
    .find((f) => existsSync(f));
  const stack = templatePkg
    ? (JSON.parse(readFileSync(templatePkg, "utf8")) as { dependencies: Record<string, string> })
        .dependencies
    : {};
  const approved = catalog.filter(
    (x) => x.status === "approved" && (x.pkg.name.startsWith("turbineh/") || x.pkg.name in stack),
  );
  const selected: Record<string, (typeof catalog)[number]> = {};
  const gaps: { capability: string; trigger: string | null }[] = [];
  for (const [cap, id] of Object.entries(required)) {
    const comp = catalog.find((x) => x.id === id);
    if (comp) selected[cap] = comp;
  }
  for (const cap of kept) {
    if (recipe.providedCapabilities?.includes(cap) || selected[cap]) continue;
    const comp = approved.find((x) => x.provides.includes(cap));
    if (comp) selected[cap] = comp;
    else gaps.push({ capability: cap, trigger: "T1" });
  }
  for (const comp of Object.values(selected))
    for (const r of comp.requires) {
      const dep = catalog.find((x) => x.id === r);
      if (dep && !Object.values(selected).some((s) => s.id === r))
        selected[dep.provides[0] ?? r] = dep;
    }
  const nativeIds = Object.values(selected)
    .filter((x) => x.pkg.name.startsWith("turbineh/"))
    .map((x) => x.id);
  const dropped = removedModules({
    recipe,
    keptCapabilities: new Set(keptModules),
    componentsDir,
    components: nativeIds,
  });
  let manifest = buildManifest({
    recipe: c.recipe,
    criteria: c.criteria,
    capabilities: [...kept, ...keptModules],
    justified: relevance.justified,
    notSelected: relevance.notSelected,
    provided: [
      ...(recipe.providedCapabilities ?? []).filter(
        (x) => !dropped.some((m) => m.provides?.includes(x)),
      ),
      ...keptModules,
    ],
    selected,
    gaps,
    catalogued: new Set(catalog.filter((x) => x.status === "approved").flatMap((x) => x.provides)),
    env: plannedEnv({
      recipesDir,
      componentsDir,
      chain: chain.map((m) => m.id),
      components: nativeIds,
      dropped: dropped.flatMap((m) => m.env ?? []),
    }),
    label,
    approved: true,
  });
  if (opts.promise) manifest = opts.promise(manifest);
  const plan = flowPlan({
    buildId: "b-consistency",
    request: {
      need: c.prompt,
      stack: detectStack({ stack: { language: "TypeScript", framework: "Next.js" } }),
    },
    slug: "recipe-check",
    recipeId: c.recipe,
    selected,
    decisions: [],
    templateDeps: {},
    entities: [],
    labels: label,
    delivery: manifest,
  });
  const root = mkdtempSync(join(tmpdir(), "tbh-delivery-"));
  dirs.push(root);
  const repoDir = join(root, "app");
  const spec = {
    ...checkSpec(c.recipe, c.prompt),
    acceptance_criteria: c.criteria,
    capabilities: kept,
  };
  const components: SelectedComponent[] = Object.entries(selected).map(
    ([capability, component]) => ({
      capability,
      component,
      why: { pBest: 1, covers: 1, risk: 0 },
    }),
  );
  const assembled = assemble({
    buildId: "b-consistency",
    recipesDir,
    recipe: c.recipe,
    outDir: repoDir,
    spec: spec as Parameters<typeof assemble>[0]["spec"],
    selected: components,
    gaps: gaps.map((g) => ({ capability: g.capability, trigger: g.trigger ?? "T1" })),
    domains,
    modules: { justified: new Set(keptModules) },
  });
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: repoDir,
      stdio: "pipe",
    });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "assembled");
  const fin = await finalize(
    {
      buildId: "b-consistency",
      repoDir,
      scope: "auto",
      facts: {
        appName: "Recipe Check",
        summary: c.prompt,
        recipe: c.recipe,
        entities: [],
        acceptanceCriteria: c.criteria,
        components: components.map((s) => ({ capability: s.capability, id: s.component.id })),
        gaps: gaps.map((g) => g.capability),
        gapLabels: CAPABILITY_LABELS,
        reusedShare: null,
      },
      metrics: {},
      manifest,
      removed: {},
      removedModules: assembled.removedModules,
    },
    {
      decider: openDecider,
      fixers: [],
      writer: { baseURL: "http://127.0.0.1:9/v1", model: "none", apiKey: "none" },
      emit: async () => undefined,
    },
  );
  const metrics = {
    components: components.map((s) => s.component.id),
    report: fin.report,
    acceptance: fin.acceptance,
  };
  return {
    plan,
    fin,
    repoDir,
    relevance,
    consistency: deliveryConsistency({ manifest: fin.manifest!, repoDir, plan, metrics }),
  };
}

describe("one source of truth (ADR-0064)", () => {
  for (const c of CASES) {
    it(
      `${c.recipe}: every surface agrees with the delivery manifest`,
      { timeout: 120_000 },
      async () => {
        const { plan, fin, consistency, relevance, repoDir } = await deliver(c, { extra: UNASKED });
        if (process.env.DEBUG_DELIVERY)
          console.log(
            c.recipe,
            JSON.stringify({
              surfaces: consistency.surfaces,
              decisions: plan.decisions.map((d) => `${d.topic}→${d.choice}`),
              notSelected: fin.manifest?.notSelected.map((n) => n.capability),
              env: fin.manifest?.env.required.map((e) => e.name),
              fp: {
                ...fin.manifest?.footprint,
                unlinkedFiles: fin.manifest?.footprint?.unlinkedFiles.slice(0, 3),
              },
              steps: fin.report.nextSteps,
            }),
          );
        expect(consistency.contradictions).toEqual([]);
        expect(fin.ok).toBe(true);
        // Every component in the package has a decision, and every decision is in the package.
        expect(plan.components.map((x) => x.id).sort()).toEqual(
          decidedComponents(fin.manifest!).sort(),
        );
        // Every transversal requirement is delivered: nothing of sign-in, data or validation is "not included".
        expect(
          fin.manifest!.entries.filter((e) => e.way === "not_included").map((e) => e.capability),
        ).toEqual([]);
        // Relevance: nothing the request did not ask for (Annex A) reaches the plan; each is listed as not selected.
        for (const cap of UNASKED.filter(
          (x) => !(c.recipe === "storefront" && x === "payments.checkout"),
        ))
          expect(relevance.justified[cap], cap).toBeUndefined();
        // F-11: the plan lists every setting of the app, BETTER_AUTH_* included, split required / optional.
        const required = plan.config
          .filter((r) => r.kind === "env" && r.required)
          .map((r) => r.name);
        expect(required).toEqual(
          expect.arrayContaining(["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]),
        );
        // The criteria are never lost between the plan and the package.
        expect(
          JSON.parse(readFileSync(join(repoDir, "turbineh.json"), "utf8")).criteria,
        ).toHaveLength(c.criteria.length);
        // F-05: footprint of code no criterion or transversal requirement links to.
        expect(fin.manifest!.footprint!.unlinkedComponents).toEqual([]);
        expect(fin.manifest!.footprint!.share).toBeLessThan(0.1);
      },
    );
  }

  it(
    "bookings: no CMS route, no public-pages component (N-02/F-05)",
    { timeout: 120_000 },
    async () => {
      const { repoDir, plan } = await deliver(CASES[1] as Case);
      expect(existsSync(join(repoDir, "src/app/[collection]"))).toBe(false);
      expect(plan.components.map((x) => x.id)).not.toContain("site.public-pages.turbineh");
    },
  );

  it(
    "ai-agents: no public assistant route without a public toolkit, nor its settings (F-05)",
    { timeout: 120_000 },
    async () => {
      const { repoDir, fin } = await deliver(CASES[2] as Case);
      expect(existsSync(join(repoDir, "src/app/api/assistant"))).toBe(false);
      expect(existsSync(join(repoDir, "src/app/assistant"))).toBe(false);
      expect(readFileSync(join(repoDir, ".env.example"), "utf8")).not.toContain("AI_PUBLIC_");
      expect(fin.manifest!.footprint!.removedModules.map((m) => m.module)).toContain(
        "component:ai.orchestrator.turbineh/public-assistant",
      );
      // Nothing in the request asks for documents or batch processing: both template modules are tree-shaken away.
      const removed = fin.manifest!.footprint!.removedModules.map((m) => m.module);
      expect(removed).toEqual(
        expect.arrayContaining([
          "recipe:ai-agents/knowledge-base",
          "recipe:ai-agents/batch-processes",
        ]),
      );
      for (const f of [
        "src/server/knowledge.ts",
        "src/app/dashboard/knowledge",
        "src/server/processes.ts",
        "src/app/dashboard/processes",
        "src/app/api/jobs/run/route.ts",
      ])
        expect(existsSync(join(repoDir, f)), f).toBe(false);
      expect(readFileSync(join(repoDir, ".env.example"), "utf8")).not.toContain(
        "JOBS_RUNNER_SECRET",
      );
      expect(fin.manifest!.notSelected.map((n) => n.capability)).toEqual(
        expect.arrayContaining(["ai.knowledge-base", "ai.batch-processing"]),
      );
      expect(readFileSync(join(repoDir, "src/db/recipe-tables.ts"), "utf8")).not.toMatch(
        /pgTable\(\s*"(documents|chunks|processes|process_items)"/,
      );
      const src = readdirSync(join(repoDir, "src/app"), { recursive: true }).join("\n");
      expect(src).not.toMatch(/turbineh:(end-)?module/);
    },
  );

  it(
    "ai-agents: a request that asks for answers from documents keeps the knowledge base, not batch processing",
    { timeout: 120_000 },
    async () => {
      const { repoDir, fin, consistency } = await deliver({
        recipe: "ai-agents",
        prompt: "A support assistant that answers customer questions from our uploaded documents.",
        criteria: [
          "Staff upload documents to the knowledge base",
          "The assistant answers from the uploaded documents and cites its sources",
        ],
      });
      expect(consistency.contradictions).toEqual([]);
      expect(existsSync(join(repoDir, "src/server/knowledge.ts"))).toBe(true);
      expect(existsSync(join(repoDir, "src/server/processes.ts"))).toBe(false);
      expect(
        fin.manifest!.entries.find((e) => e.capability === "ai.knowledge-base")?.justifiedBy[0]
          ?.kind,
      ).toBe("criterion");
    },
  );

  it(
    "regression: an approved promise the package does not keep is a broken promise everywhere, never verified",
    { timeout: 120_000 },
    async () => {
      // The audit's case: the plan approved ops.idempotency as "written and verified as glue"; generation did not
      // deliver it. (Plans no longer promise it — see the next test — but any approved promise not kept behaves so.)
      const { fin, repoDir, consistency } = await deliver(CASES[1] as Case, {
        promise: (m) => ({
          ...m,
          entries: [
            ...m.entries,
            {
              capability: "ops.idempotency",
              label: "preventing the same action from running twice",
              way: "written",
              component: null,
              justifiedBy: [{ kind: "criterion", ref: "Two patients cannot book the same slot" }],
              status: "planned",
            },
          ],
        }),
      });
      expect(consistency.contradictions).toEqual([]);
      expect(fin.ok).toBe(false);
      expect(fin.delivery.kind).toBe("unverified");
      expect(fin.delivery.label).toMatch(/not verified: 1 approved decision not kept/);
      expect(fin.manifest!.brokenPromises.map((b) => b.capability)).toEqual(["ops.idempotency"]);
      const guide = JSON.parse(readFileSync(join(repoDir, "turbineh.json"), "utf8"));
      expect(guide.status).toBe("failed");
      expect(readFileSync(join(repoDir, "AGENTS.md"), "utf8")).toContain(
        "[promise] Not delivered although approved: preventing the same action from running twice (ops.idempotency)",
      );
      expect(fin.report.nextSteps[0]).toMatch(
        /^Not delivered although the plan you approved promised it: .*\(ops\.idempotency\)/,
      );
      expect(readFileSync(join(repoDir, "TURBINEH_REPORT.md"), "utf8")).toMatch(
        /not verified: 1 approved decision not kept/,
      );
    },
  );

  it("plans never promise to write what TurbineH does not write: ops.idempotency is not included, with why", () => {
    const m = buildManifest({
      recipe: "ai-agents",
      criteria: ["A post is never published twice"],
      capabilities: ["ops.idempotency"],
      justified: {
        "ops.idempotency": [{ kind: "criterion", ref: "A post is never published twice" }],
      },
      notSelected: [],
      provided: [],
      selected: {},
      gaps: [{ capability: "ops.idempotency", trigger: "T1" }],
      catalogued: new Set(),
      env: { required: [], optional: [] },
      label: (x) => CAPABILITY_LABELS[x] ?? x,
      approved: true,
    });
    expect(m.entries[0]).toMatchObject({ way: "not_included", capability: "ops.idempotency" });
    expect(m.entries[0]?.reason).toMatch(/unique constraint/);
    const plan = flowPlan({
      buildId: "b",
      request: {
        need: "x",
        stack: detectStack({ stack: { language: "TypeScript", framework: "Next.js" } }),
      },
      slug: "x",
      recipeId: "ai-agents",
      selected: {},
      decisions: [],
      templateDeps: {},
      entities: [],
      labels: (x) => x,
      delivery: m,
    });
    expect(plan.needsApproval.join("\n")).not.toMatch(/TurbineH writes it/);
    expect(plan.needsApproval.join("\n")).toMatch(
      /^Not included in this build: preventing the same action/m,
    );
    expect(plan.decisions[0]).toMatchObject({
      topic: "ops.idempotency",
      choice: "not included",
      way: "not_included",
    });
  });
});
