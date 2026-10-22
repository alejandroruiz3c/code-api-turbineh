import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble, mergedRecipe, recipeChain } from "@turbineh/assembler";
import type { BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { nativeSelection } from "./combinations.js";
import {
  asksForTheUseCase,
  hasExistingProject,
  planCriteria,
  proofModules,
  withGeneral,
} from "./pipeline.js";
import { withScope } from "./scope.js";
import type { Plan } from "@turbineh/shared";

/**
 * ADR-0075 · what the gate and the plan promise is what the delivered package proves. Every fixture is synthetic and
 * paraphrased (same kind of need as real requests, other words): never a customer's prompt.
 */
const repoRoot = join(import.meta.dirname, "..", "..", "..");
const recipesDir = join(repoRoot, "catalog/recipes");

const spec = (recipe: BuildSpec["recipe"], criteria: string[], extra: Partial<BuildSpec> = {}) =>
  ({
    recipe,
    out_of_scope_reason: null,
    closest_recipe: null,
    app_name: "Helpdesk Buddy",
    slug: "helpdesk-buddy",
    summary: "A helpdesk bot",
    roles: ["visitor", "agent"],
    entities: [],
    pages: [{ path: "/", purpose: "Home page", auth_required: false }],
    capabilities: ["security.headers"],
    acceptance_criteria: criteria,
    ...extra,
  }) as BuildSpec;

/** The criteria the assembled package links to a shipped test (.turbineh/acceptance.json), by status. */
function assembleAndLink(s: BuildSpec, prompt: string, justifiedModules: Set<string>) {
  const chain = recipeChain(recipesDir, s.recipe);
  const merged = mergedRecipe(chain);
  const { selected } = nativeSelection(repoRoot, s.recipe, prompt);
  const outDir = join(mkdtempSync(join(tmpdir(), "delivery-coverage-")), "app");
  assemble({
    buildId: "delivery-coverage",
    recipesDir,
    recipe: s.recipe,
    outDir,
    spec: {
      ...s,
      capabilities: [
        ...new Set([...s.capabilities, ...merged.defaultCapabilities]),
      ] as BuildSpec["capabilities"],
    },
    selected,
    gaps: [],
    modules: { justified: justifiedModules },
  });
  return JSON.parse(readFileSync(join(outDir, ".turbineh/acceptance.json"), "utf8")) as {
    criterion: string;
    status: string;
  }[];
}

describe("tree-shaking keeps the tests that prove the plan's criteria (ADR-0075)", () => {
  // The canonical wording the plan stored for a helpdesk bot that answers from FAQ pages and hands chats to a person.
  const criteria = [
    "An assistant answers a customer question from a help-centre FAQ article in the knowledge base and cites that article",
    "An assistant answers from the knowledge base",
    "When the assistant hands a conversation to a person, the team is emailed, the conversation is listed for the team as needing a person and the user is told a person will follow up",
  ];
  const prompt =
    "A helpdesk bot that replies from our FAQ pages and hands tricky chats to a person";

  it("justifies the knowledge-base module by the criteria its tests prove", () => {
    const needed = proofModules(spec("ai-agents", criteria), recipesDir, "ai-agents", []);
    expect(Object.keys(needed)).toEqual(["ai.knowledge-base"]);
    expect(needed["ai.knowledge-base"]).toEqual(criteria.slice(0, 2));
  });

  it("the package links every criterion the plan marks covered (it did not when relevance dropped the module)", () => {
    const s = spec("ai-agents", criteria);
    const planned = planCriteria(criteria, recipesDir, "ai-agents", []);
    expect(planned.every((c) => c.status === "covered")).toBe(true);
    // Before: relevance alone found no requirement asking for "a knowledge base of uploaded documents".
    const before = assembleAndLink(s, prompt, new Set());
    expect(before.filter((a) => a.status === "open").map((a) => a.criterion)).toEqual(
      criteria.slice(0, 2),
    );
    const after = assembleAndLink(
      s,
      prompt,
      new Set(Object.keys(proofModules(s, recipesDir, "ai-agents", []))),
    );
    expect(after.filter((a) => a.status === "open")).toEqual([]);
  });
});

describe("a request that only names the use case gets the use case's canonical criteria (ADR-0075)", () => {
  it.each([
    ["an e-commerce shop", "storefront"],
    ["Customer portal", "client-portal"],
    ["a simple booking app for my salon", "bookings"],
  ])("%j names only %s", (prompt, recipe) => {
    expect(asksForTheUseCase(prompt, recipe)).toBe(true);
  });

  it.each([
    ["an e-commerce shop that also runs auctions and sells gift cards", "storefront"],
    ["a booking agent for a vet practice with SMS reminders", "bookings"],
    ["customer portal with invoices paid by card and live chat", "client-portal"],
  ])("%j states functions of its own", (prompt, recipe) => {
    expect(asksForTheUseCase(prompt, recipe)).toBe(false);
  });

  it("is the use case's catalogue text itself", () => {
    const text =
      "Client portal where clients submit requests with file uploads and follow their status; staff review and update them";
    expect(asksForTheUseCase(text, "client-portal")).toBe(true);
  });

  it("replaces the compiler's guesses with the use case's functions, every one proved at planning", () => {
    // What a compiler invents for two words: none of it was asked.
    const guessed = spec("client-portal", [
      "Given a client is on the dashboard, when they open 'Latest updates', then a list of recent payments is shown",
      "Given a client is on the dashboard, when they click 'Help', then a contact form opens",
    ]);
    const out = withGeneral(guessed, "Customer portal", recipesDir);
    expect(out.acceptance_criteria).not.toContain(guessed.acceptance_criteria[0]);
    expect(out.acceptance_criteria.length).toBeGreaterThanOrEqual(4);
    const planned = planCriteria(out.acceptance_criteria, recipesDir, "client-portal", []);
    expect(planned.filter((c) => c.status !== "covered")).toEqual([]);
  });

  it("keeps a detailed request's own criteria", () => {
    const own = spec("client-portal", ["Clients can pay their invoices online by card"]);
    expect(
      withGeneral(own, "a portal where our clients pay invoices by card", recipesDir)
        .acceptance_criteria,
    ).toEqual(own.acceptance_criteria);
  });
});

describe("an empty environment is a new app, not parts for a project (ADR-0075)", () => {
  const stack = (s: Partial<Plan["stack"]>): Plan["stack"] => ({
    language: "unknown",
    framework: null,
    packageManager: null,
    versions: {},
    source: "files",
    adaptationPending: false,
    ...s,
  });
  it("needs a repository or files that tell the project", () => {
    expect(hasExistingProject(stack({}))).toBe(false);
    expect(hasExistingProject(stack({ source: "declared", language: "typescript" }))).toBe(false);
    expect(hasExistingProject(stack({ source: "repo" }))).toBe(true);
    expect(hasExistingProject(stack({ language: "typescript", framework: "nextjs" }))).toBe(true);
  });
});

describe("the plan states the functional coverage it expects (ADR-0075)", () => {
  it("covered means within the use case; the message says how many are proved", () => {
    const plan = {
      criteria: [
        { criterion: "a", status: "covered", tests: ["t"] },
        { criterion: "b", status: "open", tests: [] },
      ],
      needsApproval: [],
      capability: { name: "X" },
    } as unknown as Plan;
    withScope(
      plan,
      {
        status: "covered",
        via: "use_case",
        useCase: "saas-crud",
        requirements: [],
        notCovered: [],
        decider: null,
      },
      "X",
    );
    expect(plan.scope?.functional).toEqual({ proven: 1, total: 2 });
    expect(plan.scope?.message).toMatch(/1 of 2 functional requirement\(s\) are proved by tests/);
    expect(plan.scope?.message).not.toMatch(/Every requirement of the request is covered/);
  });
});
