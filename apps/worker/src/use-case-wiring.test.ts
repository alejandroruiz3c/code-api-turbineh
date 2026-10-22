import { join } from "node:path";
import type { BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { BLOG_PROMPT, checkSpec, MATCHING_PROMPT, RECORDER_PROMPT } from "./combinations.js";
import { wireFidelitySync } from "./fidelity-wiring.js";
import { canonicalizeSpec, gateComponents, provenAtGate } from "./pipeline.js";
import { gateRequest } from "./scope.js";

/**
 * Use cases added from real demand (ADR-0073), against the real catalogue: a blog, a screen + camera recorder and
 * B2B matching are selected by code with the request's parameters, and the functions their canonical criteria prove
 * count at the scope gate. Fixtures are synthetic paraphrases, never customers' words.
 */
const repo = join(import.meta.dirname, "../../..");
const componentsDir = join(repo, "catalog/components");
const recipesDir = join(repo, "catalog/recipes");
const offline = new Proxy({}, { get: () => async () => Promise.reject(new Error("offline")) });

const selected = (recipe: string, prompt: string, chain = [recipe, "saas-crud"]) =>
  Object.fromEntries(
    wireFidelitySync(prompt, checkSpec(recipe, prompt), {
      recipeId: recipe,
      recipeChain: [...new Set(chain)],
      componentsDir,
      knownEntities: [],
    }).wired.selected.map((s) => [s.component, s.params]),
  );

const spec = (over: Partial<BuildSpec>): BuildSpec => ({
  ...checkSpec("saas-crud", ""),
  app_name: "Sample",
  summary: "Sample app",
  ...over,
});

describe("use cases from real demand are selected by code (ADR-0073)", () => {
  it("a blog on a landing page selects content.blog with its params", () => {
    expect(selected("landing-waitlist", BLOG_PROMPT)["content.blog.turbineh"]).toEqual({
      postsPerPage: 10,
      wordsPerMinute: 200,
      feedItems: 20,
    });
  });
  it("a Loom-like 4K recorder selects media.screen-recording asking for 2160p", () => {
    expect(selected("saas-crud", RECORDER_PROMPT)["media.screen-recording.turbineh"]).toMatchObject(
      {
        maxResolution: "2160p",
        layouts: ["bubble", "side-by-side", "screen-only", "camera-only"],
        shareLinks: true,
      },
    );
  });
  it("B2B tender monitoring selects matching (tenders) and role management", () => {
    const s = selected("saas-crud", MATCHING_PROMPT);
    expect(s["domain.matching.turbineh"]).toMatchObject({
      entity: { singular: "tender", plural: "tenders" },
    });
    expect(Object.keys(s)).toContain("domain.membership-access.turbineh");
  });
});

describe("the gate counts the functions of components selected by code (ADR-0073)", () => {
  it("a recorder no product family matched is covered by the recording component's proven functions", async () => {
    const prompt =
      "A web tool similar to Loom to record my screen and my camera in 4K with a choice of layouts";
    const s = spec({
      recipe: "out_of_scope",
      acceptance_criteria: [
        "Given the user chooses screen recording, the app captures the screen video",
        "Given a camera that supports it, the webcam is recorded at 3840x2160",
        "While recording, choosing a layout rearranges the screen and camera feeds",
      ],
    });
    const ids = gateComponents(prompt, s, componentsDir);
    expect(ids).toContain("media.screen-recording.turbineh");
    canonicalizeSpec(s, recipesDir, prompt, ids);
    const proven = provenAtGate(s, recipesDir, ids);
    expect(proven.size).toBe(s.acceptance_criteria.length);
    const v = await gateRequest({
      prompt,
      spec: s,
      componentsDir,
      decider: offline as never,
      provenByTests: proven,
      domainComponents: ids,
    });
    expect(v.status).toBe("covered");
    expect(v.useCase).toBe("components");
  });

  it("an out-of-scope request no component selects stays without proof", () => {
    const s = spec({ recipe: "out_of_scope", acceptance_criteria: ["The drone flies a route"] });
    const ids = gateComponents("Firmware for a delivery drone", s, componentsDir);
    expect(ids).toEqual([]);
    expect(provenAtGate(s, recipesDir, ids).size).toBe(0);
  });

  it("B2B: organization switch, role assignment, profile, isolation and audit map to proven functions", () => {
    const prompt =
      "A multi-tenant B2B platform to monitor grants.\n- Organization sign-up, authentication and role-based access control.\n- Users belong to several organizations with strict data isolation.\n- Each organization configures its sectors, activities, regions and interests.\n- A dashboard of the grants relevant to its interests.\n- Audit log of every change.";
    const s = spec({
      entities: [{ name: "Grant", fields: [{ name: "title", type: "string", required: true }] }],
      acceptance_criteria: [
        "A user switches between the organizations they belong to from a selector",
        "An administrator assigns the editor or viewer role to a user of the organization",
        "An organization saves a profile with its sectors, regions and business interests",
        "A user cannot read another organization's data in any API request",
        "Every change is recorded in the audit log with the user and the time",
      ],
    });
    const ids = gateComponents(prompt, s, componentsDir);
    expect(ids).toEqual(
      expect.arrayContaining([
        "domain.matching.turbineh",
        "domain.membership-access.turbineh",
        "domain.audit-log.turbineh",
      ]),
    );
    canonicalizeSpec(s, recipesDir, prompt, ids);
    expect(provenAtGate(s, recipesDir, ids).size).toBe(5);
  });
});
