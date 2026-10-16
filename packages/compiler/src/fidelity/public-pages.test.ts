import { describe, expect, it } from "vitest";
import type { BuildSpec } from "../build-spec.js";
import { specFidelitySync } from "./index.js";

const spec = (recipe: BuildSpec["recipe"], criteria: string[]): BuildSpec =>
  ({
    recipe,
    out_of_scope_reason: null,
    closest_recipe: null,
    app_name: "Flex Physio",
    slug: "flex-physio",
    summary: "Online bookings for a physiotherapy clinic.",
    roles: ["owner", "staff"],
    entities: [
      { name: "Service", fields: [{ name: "name", type: "string", required: true }] },
      { name: "Booking", fields: [{ name: "startsAt", type: "datetime", required: true }] },
    ],
    pages: [{ path: "/", purpose: "Home", auth_required: false }],
    capabilities: ["security.headers", "data.validation"],
    acceptance_criteria: criteria,
    site: null,
    palette: null,
  }) as unknown as BuildSpec;

describe("site.public-pages only when the request asks for public pages of an entity (ADR-0064, audit N-02)", () => {
  it("a bookings app's public booking page is not a CMS collection of services", () => {
    const prompt =
      "Physiotherapy clinic: patients book a 45-minute slot for a service on the public page, get a confirmation email with a cancel link, and there are no double bookings.";
    const { fidelity } = specFidelitySync(
      prompt,
      spec("bookings", ["A patient books a slot on the public page"]),
      {
        recipe: "bookings",
      },
    );
    expect(fidelity.patterns.map((p) => p.id)).not.toContain("site.public-pages");
  });

  it("an entity with its own public page still gets one", () => {
    const prompt = "Each service has its own page with a description. Patients book online.";
    const { fidelity } = specFidelitySync(
      prompt,
      spec("saas-crud", ["Each service has its own page"]),
      {
        recipe: "saas-crud",
      },
    );
    expect(fidelity.patterns.map((p) => p.id)).toContain("site.public-pages");
  });
});
