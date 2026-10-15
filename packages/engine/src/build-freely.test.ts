import { describe, expect, it } from "vitest";
import {
  buildPlan,
  compatibility,
  detectStack,
  explainFailure,
  flowResult,
  normalizeFramework,
  openCriteriaLeft,
  planOutcome,
  USE_CASES,
  type PlanInput,
} from "./index.js";

/** Jargon the owner flagged (ADR-0050): never shown to a person again. */
const JARGON =
  /pages need porting|only the stack was declared|adaptation to your concrete project is pending|not covered yet/i;

const storefront = USE_CASES.find((u) => u.id === "storefront") ?? null;

const planFor = (stack: PlanInput["stack"], extra: Partial<PlanInput> = {}) =>
  buildPlan({
    id: "pl_stack",
    need: "A simple online store for a sock brand with sizes, cart and card payments",
    slug: "sock-store",
    stack,
    useCase: storefront,
    components: [
      {
        id: "payments.checkout.stripe",
        version: "1.0.0",
        license: "MIT",
        purl: "pkg:npm/stripe@1.0.0",
        capability: "payments.checkout",
        why: "Card payments",
      },
    ],
    gaps: [],
    decisions: [],
    dependencies: [{ name: "next", version: "16.3.8" }],
    ...extra,
  });

const text = (x: unknown) => JSON.stringify(x);

describe("framework names from people", () => {
  it.each([
    ["Next.js", "nextjs"],
    ["next", "nextjs"],
    ["NextJS", "nextjs"],
    ["Vite + React", "vite"],
    ["NestJS", "nestjs"],
    ["Express", "express"],
    ["FastAPI", "fastapi"],
    ["", null],
  ])("%s → %s", (input, id) => expect(normalizeFramework(input)).toBe(id));
});

describe("stack-only plan (no repository, no files) → a complete app", () => {
  // The owner's production path, 2026-10-13: TypeScript · Next.js · "next 16, node 24, postgres 17".
  const owner = detectStack({
    stack: {
      language: "TypeScript",
      framework: "Next.js",
      versions: { next: "16", node: "24", postgres: "17" },
    },
  });

  it("is compatible, needs no approval and defaults to generating the complete app", () => {
    const plan = planFor(owner);
    expect(plan.compatible).toBe(true);
    expect(plan.incompatibilities).toEqual([]);
    expect(plan.needsApproval).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(plan.outcome?.kind).toBe("complete_app");
    expect(plan.outcome?.title).toBe("A complete Next.js app, built for you");
    expect(plan.outcome?.actions.map((a) => a.id)).toEqual([
      "generate",
      "connect_repo",
      "upload_files",
    ]);
    expect(plan.outcome?.actions[0]?.label).toBe("Generate the complete app");
  });

  it("lists the files of a new project, not changes to an existing one", () => {
    const plan = planFor(owner);
    expect(plan.files.every((f) => f.action === "add")).toBe(true);
    expect(plan.files.map((f) => f.path)).toContain("sock-store/src/app/");
    expect(plan.files.some((f) => f.path === "package.json")).toBe(false);
  });

  it("never shows the jargon the owner flagged", () => {
    expect(text(planFor(owner))).not.toMatch(JARGON);
  });

  it("other JS frameworks: says what they get (server modules) and offers a complete Next.js app first", () => {
    const express = detectStack({ stack: { language: "TypeScript", framework: "Express" } });
    const plan = planFor(express);
    expect(plan.compatible).toBe(true);
    expect(plan.needsApproval).toEqual([]);
    expect(plan.outcome?.kind).toBe("server_modules");
    expect(plan.outcome?.meaning).toMatch(/server code under src\/.*import into Express/);
    expect(plan.outcome?.meaning).toMatch(/rebuild them in Express/);
    expect(plan.outcome?.actions[0]).toMatchObject({
      id: "build_nextjs_app",
      label: "Build a complete Next.js app instead",
    });
    expect(text(plan)).not.toMatch(JARGON);
  });

  it("other languages: a separate service, with the one-click Next.js app", () => {
    const python = detectStack({ stack: { language: "Python", framework: "Django" } });
    const o = planOutcome(python, "use_case");
    expect(o.kind).toBe("separate_service");
    expect(o.meaning).toMatch(/nothing is written in Python or Django/);
    expect(o.actions[0]?.id).toBe("build_nextjs_app");
  });

  it("states versions it changes instead of refusing them", () => {
    const old = detectStack({
      stack: { language: "TypeScript", framework: "Next.js", versions: { next: "14", node: "18" } },
    });
    expect(compatibility(old, "use_case").compatible).toBe(true);
    const notes = planOutcome(old, "use_case").notes.join(" ");
    expect(notes).toMatch(/built on Next.js 16.*you entered 14/);
    expect(notes).toMatch(/Node.js 20 or later.*you entered 18/);
  });
});

describe("existing projects keep explicit, actionable incompatibilities", () => {
  it("an Express project: what they get, what to do, and the standalone alternative", () => {
    const s = detectStack({
      files: {
        "package.json": JSON.stringify({ dependencies: { express: "5.0.0" } }),
        "tsconfig.json": "{}",
      },
    });
    const c = compatibility(s, "use_case");
    expect(c.compatible).toBe(false);
    expect(c.incompatibilities[0]).toMatch(/Your project uses Express/);
    expect(c.incompatibilities[0]).toMatch(/build a standalone Next.js app instead/);
    expect(c.incompatibilities.join(" ")).not.toMatch(JARGON);
    expect(planOutcome(s, "use_case").actions.map((a) => a.id)).toContain("build_nextjs_app");
  });
});

describe("what is left (free-form building)", () => {
  it("gaps and uncovered parts are listed with where to implement them; generation is not blocked", () => {
    const plan = planFor(detectStack({ stack: { language: "TypeScript", framework: "Next.js" } }), {
      gaps: ["ui.map"],
      notCovered: ["Loyalty points"],
      labels: (c) => (c === "ui.map" ? "maps" : c),
    });
    expect(plan.left).toEqual([
      expect.objectContaining({ part: "maps", where: expect.stringMatching(/AGENTS.md/) }),
      expect.objectContaining({
        part: "Loyalty points",
        where: expect.stringMatching(/AGENTS.md/),
      }),
    ]);
    expect(plan.missing[0]).toMatch(/^maps: no verified component yet/);
  });

  it("open acceptance criteria become 'what is left'", () => {
    expect(
      openCriteriaLeft([
        { criterion: "Owner sees totals", status: "covered" },
        { criterion: "Export to PDF", status: "open" },
      ]),
    ).toEqual([expect.objectContaining({ part: "Export to PDF" })]);
  });
});

describe("failure messages: what happened, why, what to do, how to resume", () => {
  const cases: [string | null, string, RegExp][] = [
    [
      "rejected by the Abuse Guard: phishing (0.91)",
      "safety_blocked",
      /never builds software for malware, phishing/,
    ],
    ["BuildSpec invalid (T5)", "need_not_understood", /Two models tried/],
    [
      "out of scope for the beta: The prompt does not match any beta recipe. (closest recipe: none)",
      // ADR-0052: legacy out-of-scope runs read like any uncovered request (never "built on the closest template").
      "use_case_not_covered",
      /notify you with priority/,
    ],
    [
      "Use case not covered by the library: AI drafts a post | Publish to Instagram",
      "use_case_not_covered",
      /notify you with priority/,
    ],
    ["worker lost the build twice", "interrupted", /not caused by your description/],
    ["internal error", "interrupted", /restart or an internal error/],
    [
      "recipe bookings requires domain.bookings, which is not an approved component",
      "component_unavailable",
      /re-verified/,
    ],
    ["Delivered, not verified: 10/11 checks passed. Failing: e2e", "verification_failed", /10\/11/],
    [
      "Not delivered: a security or policy check blocks (9/11 checks passed) — report only. Blocking secrets finding",
      "security_blocked",
      /never code with a blocking finding/,
    ],
    ["sandbox step timed out", "timeout", /time limit/],
    ["something odd", "generation_failed", /something odd/],
    [null, "generation_failed", /without a reason/],
  ];
  it.each(cases)("%s → %s", (raw, code, why) => {
    const p = explainFailure(raw, { id: "b1", fromPlan: true });
    expect(p.code).toBe(code);
    expect(p.why).toMatch(why);
    expect(p.title.length).toBeGreaterThan(5);
    expect(p.action.length).toBeGreaterThan(10);
    expect(p.next.label.length).toBeGreaterThan(3);
    expect(p.message).toContain(p.title);
    expect(`${p.message} ${p.action}`).not.toMatch(/BuildSpec|T5|Abuse Guard|recipe|out of scope/);
  });

  it("an approved plan resumes generation; a plain run starts again", () => {
    expect(explainFailure("internal error", { id: "b1", fromPlan: true }).next.kind).toBe(
      "generate_again",
    );
    expect(explainFailure("internal error", { id: "b1" }).next.kind).toBe("new_flow");
    expect(explainFailure("boom", { id: "b1", fromPlan: true }).resume).toBe(
      "turbineh apply --resume b1",
    );
  });

  it("flowResult carries the same explanation (API, CLI)", () => {
    const r = flowResult(
      {
        id: "b2",
        status: "failed",
        options: { mode: "generate" },
        metrics: {},
        artifact: null,
        error: "BuildSpec invalid (T5)",
      },
      { zipUrl: null, manifestUrl: null },
    );
    expect(r.errors[0]).toMatchObject({ code: "need_not_understood" });
    // Only the shared ProductError fields travel in the contract.
    for (const k of Object.keys(r.errors[0] ?? {}))
      expect(["action", "code", "message", "resume"]).toContain(k);
  });
});
