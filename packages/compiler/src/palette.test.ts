import { describe, expect, it } from "vitest";
import { buildSpecSchema } from "./build-spec.js";
import { extractPalette } from "./palette.js";

describe("palette from the prompt (S1, deterministic)", () => {
  it("reads the Frontiers shop identity: background, accents, call-to-action and type", () => {
    const prompt =
      'Build a simple online shop for "Northwind Coffee Roasters". Visual identity: navy background `#001A5A`, ' +
      "teal accents `#34D8C4`, amber call-to-action buttons `#F2B24B`, clean sans-serif type. Shoppers browse…";
    expect(extractPalette(prompt)).toEqual({
      background: "#001a5a",
      accent: "#34d8c4",
      cta: "#f2b24b",
      font: "system",
    });
  });

  it("accepts the role after the colour, short hex, rgb() and text colours", () => {
    expect(
      extractPalette("Use #fff8e7 as the background; buttons in rgb(200, 30, 60); text #333."),
    ).toEqual({ background: "#fff8e7", cta: "#c81e3c", text: "#333333" });
    expect(extractPalette("A serif look with links in #0a7")).toEqual({
      accent: "#00aa77",
      font: "serif",
    });
  });

  it("assigns colours without a role to the call-to-action, then the accent", () => {
    expect(extractPalette("Brand colours #112233 and #445566.")).toEqual({
      cta: "#112233",
      accent: "#445566",
    });
  });

  it("returns null when the prompt states no colour or type", () => {
    expect(extractPalette("A booking app for a physio clinic")).toBeNull();
  });

  it("is part of the BuildSpec (optional)", () => {
    const spec = {
      recipe: "storefront",
      out_of_scope_reason: null,
      closest_recipe: null,
      app_name: "Northwind",
      slug: "northwind",
      summary: "Coffee shop online.",
      roles: ["owner"],
      entities: [],
      pages: [{ path: "/", purpose: "Home", auth_required: false }],
      capabilities: ["security.headers"],
      acceptance_criteria: ["Shoppers can search", "Owner signs in", "Webhook marks paid"],
    };
    expect(buildSpecSchema.safeParse(spec).success).toBe(true);
    expect(buildSpecSchema.safeParse({ ...spec, palette: { background: "#001a5a" } }).success).toBe(
      true,
    );
    expect(buildSpecSchema.safeParse({ ...spec, palette: { background: "navy" } }).success).toBe(
      false,
    );
  });
});
