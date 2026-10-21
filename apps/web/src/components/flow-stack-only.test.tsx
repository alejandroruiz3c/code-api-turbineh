import { buildPlan, detectStack, explainFailure, USE_CASES } from "@turbineh/engine";
import type { EnvironmentInput } from "@turbineh/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SUPPORTED_STACK as SHARED_STACK } from "@turbineh/shared";
import { environmentFor, stackNote, SUPPORTED_STACK } from "../lib/flow-environment";
import { currentRun, finalFinish } from "../lib/flow-events";
import { PlanReview } from "./plan-review";

/**
 * /flows/new, stack only (no repository, no files) → a complete app (ADR-0050). The wizard's defaults go through the
 * same code the API runs (detectStack → plan) and the plan screen is rendered as the person sees it.
 */

const JARGON =
  /pages need porting|only the stack was declared|adaptation to your concrete project is pending|not covered yet/i;

const defaults = {
  repo: "",
  files: {},
  language: "TypeScript",
  framework: "Next.js",
  versions: "next 16, node 24, postgres 17",
};

function planScreen(environment: EnvironmentInput) {
  const plan = buildPlan({
    id: "92b75be1-362e-4bb7-a156-ca9ff86abd16",
    need: "A simple online store for a sock brand with sizes, cart and card payments",
    slug: "sock-store",
    stack: detectStack(environment),
    useCase: USE_CASES.find((u) => u.id === "storefront") ?? null,
    components: [],
    gaps: [],
    decisions: [],
    dependencies: [{ name: "next", version: "16.3.8" }],
  });
  const html = renderToStaticMarkup(
    <PlanReview plan={plan} approved={{}} onApprove={() => {}} onAction={() => {}} />,
  );
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'");
  const actions = [...html.matchAll(/data-action="([a-z_]+)"[^>]*>([^<]+)</g)].map((m) => ({
    id: m[1],
    label: m[2]?.replace(/&#x27;|&#39;/g, "'"),
  }));
  return { plan, html, text, actions };
}

describe("/flows/new · stack only → complete app", () => {
  it("defaults to a new complete Next.js app", () => {
    const env = environmentFor("app", defaults);
    expect(env).toEqual({
      stack: {
        language: "TypeScript",
        framework: "Next.js",
        versions: { next: "16", node: "24", postgres: "17" },
      },
    });
    expect(stackNote("TypeScript", "Next.js")).toMatch(/complete Next.js project/);
    expect(stackNote("TypeScript", "Next.js")).toContain(
      "Supported stack: TypeScript + Next.js + PostgreSQL + Drizzle",
    );
    expect(stackNote("TypeScript", "Next.js")).not.toMatch(/main path/);
  });

  it("the owner's path: a compatible plan whose first action generates the complete app", () => {
    const { plan, text, actions } = planScreen(environmentFor("app", defaults));
    expect(plan.compatible).toBe(true);
    expect(plan.needsApproval).toEqual([]);
    expect(text).toContain("A complete Next.js app, built for you");
    expect(actions).toEqual([
      { id: "generate", label: "Generate the complete app" },
      { id: "connect_repo", label: "Add it to my repository" },
      { id: "upload_files", label: "Upload my project's files" },
    ]);
    expect(text).toContain("What you receive");
    expect(text).not.toContain("Before you continue");
    expect(text).not.toMatch(JARGON);
  });

  it("Express: says what you get and offers a complete Next.js app in one click", () => {
    const { text, actions } = planScreen(
      environmentFor("app", { ...defaults, framework: "Express" }),
    );
    expect(actions[0]).toEqual({
      id: "build_nextjs_app",
      label: "Build a complete Next.js app instead",
    });
    expect(text).toMatch(/server code under src\/ .* import into Express/);
    expect(text).not.toMatch(JARGON);
    expect(stackNote("TypeScript", "Express")).toMatch(/not converted to Express/);
    expect(stackNote("TypeScript", "Express")).toMatch(/^Express is not supported for new apps/);
    expect(stackNote("Python", "FastAPI")).toMatch(/^Python is not supported for new apps/);
  });

  it("Python: a separate service, never a dead end", () => {
    const { actions, plan } = planScreen(
      environmentFor("app", { ...defaults, language: "Python", framework: "FastAPI" }),
    );
    expect(plan.outcome?.kind).toBe("separate_service");
    expect(actions.map((a) => a.id)).toEqual(["build_nextjs_app", "generate"]);
  });
});

describe("live trace of a plan → generation flow (production 2026-10-13, flow 0bfd9dff)", () => {
  // The same row carries the plan run and the generation run.
  const events = [
    { id: 1, phase: "queued", type: "queued" },
    { id: 2, phase: "compiling", type: "start" },
    { id: 3, phase: "resolving", type: "done" },
    { id: 4, phase: "done", type: "finished" }, // the plan's own finish
    { id: 5, phase: "queued", type: "queued" }, // "Generate & verify"
    { id: 6, phase: "compiling", type: "start" },
    { id: 7, phase: "verifying", type: "start" },
  ];

  it("the plan's finish is not the end of the flow while the generation runs", () => {
    expect(finalFinish(events)).toBeUndefined();
    expect(currentRun(events).map((e) => e.id)).toEqual([5, 6, 7]);
    expect(currentRun(events).some((e) => e.type === "finished")).toBe(false);
  });

  it("the generation's finish ends it", () => {
    const done = [...events, { id: 8, phase: "done", type: "finished" }];
    expect(finalFinish(done)?.id).toBe(8);
  });

  it("a failure says what happened, why, what to do and offers to generate again", () => {
    const p = explainFailure("worker lost the build twice", { id: "0bfd9dff", fromPlan: true });
    expect(p.title).toBe("The build was interrupted on our side");
    expect(p.next).toEqual({ label: "Generate again", kind: "generate_again" });
  });
});

describe("supported stack (ADR-0069)", () => {
  it("the wizard says the same stack as the plan's stack note", () => {
    expect(SUPPORTED_STACK).toBe(SHARED_STACK);
  });
});
