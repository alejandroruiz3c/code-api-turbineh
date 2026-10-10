import { describe, expect, it } from "vitest";
import { buildSpecJsonSchema, buildSpecSchema } from "./build-spec.js";

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

  it("requires a reason when out of scope", () => {
    expect(buildSpecSchema.safeParse({ ...valid, recipe: "out_of_scope" }).success).toBe(false);
  });

  it("exports a JSON schema for constrained decoding", () => {
    expect(buildSpecJsonSchema).toHaveProperty("properties.recipe");
  });
});
