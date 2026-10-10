import { describe, expect, it } from "vitest";
import { buildSpecSchema } from "./build-spec.js";
import { CAPABILITY_QUESTIONS, PARTS } from "./parts.js";

const valid = {
  recipe: "saas-crud",
  out_of_scope_reason: null,
  closest_recipe: null,
  app_name: "Gym Manager",
  slug: "gym-manager",
  summary: "Manage gym members and plans.",
  roles: ["admin", "staff"],
  entities: [{ name: "Member", fields: [{ name: "email", type: "email", required: true }] }],
  pages: [{ path: "/members", purpose: "List members", auth_required: true }],
  capabilities: ["auth.session", "security.headers", "data.validation"],
  acceptance_criteria: [
    "Admin can create a member",
    "Staff can list members",
    "Anonymous users are redirected to login",
  ],
};

describe("BuildSpec", () => {
  it("accepts a valid spec", () => {
    expect(buildSpecSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown capabilities and duplicate entities", () => {
    expect(buildSpecSchema.safeParse({ ...valid, capabilities: ["ai.chat"] }).success).toBe(false);
    expect(
      buildSpecSchema.safeParse({ ...valid, entities: [...valid.entities, ...valid.entities] })
        .success,
    ).toBe(false);
  });

  it("accepts dynamic segments as :param and rejects other characters", () => {
    const page = (path: string) => ({
      ...valid,
      pages: [{ path, purpose: "Detail", auth_required: true }],
    });
    expect(buildSpecSchema.safeParse(page("/members/:id")).success).toBe(true);
    expect(buildSpecSchema.safeParse(page("/Members?x=1")).success).toBe(false);
  });

  it("deduplicates capabilities deterministically", () => {
    const res = buildSpecSchema.safeParse({
      ...valid,
      capabilities: ["auth.session", "auth.session", "security.headers"],
    });
    expect(res.success && res.data.capabilities).toEqual(["auth.session", "security.headers"]);
  });

  it("requires a reason when out of scope", () => {
    expect(buildSpecSchema.safeParse({ ...valid, recipe: "out_of_scope" }).success).toBe(false);
  });

  it("asks one atomic decider question per optional capability", () => {
    expect(Object.keys(CAPABILITY_QUESTIONS).length).toBeGreaterThan(10);
    expect(Object.keys(CAPABILITY_QUESTIONS)).not.toContain("security.headers");
  });

  it("keeps every generated part small and bounded", () => {
    expect(Object.keys(PARTS)).toEqual(["meta", "entities", "pages", "criteria"]);
  });
});
