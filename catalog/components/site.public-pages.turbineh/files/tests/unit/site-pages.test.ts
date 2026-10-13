import { describe, expect, it } from "vitest";
import { SitePagesParams, sitePagesConfig, toCollections } from "@/site-pages/config";
import { matchesFilters, safeImageUrl, slugify } from "@/site-pages/rules";

/** Contract of site.public-pages.turbineh: collections from params, slugs, filters and safe image URLs. */
describe("public pages", () => {
  it("the shipped params are valid", () => {
    expect(SitePagesParams.safeParse(sitePagesConfig).success).toBe(true);
  });

  it("names collections from the entity and keeps only real filter fields from the request", () => {
    const [projects, jobs] = toCollections({
      pages: [
        {
          entity: "Project",
          path: "/projects",
          detail: true,
          filters: ["sector", "a page per project", "Sector"],
        },
        { entity: "JobPosition", path: "/careers", detail: true, filters: ["contract type"] },
      ],
      seo: true,
    });
    expect(projects).toMatchObject({
      key: "projects",
      plural: "Projects",
      filters: [{ key: "sector", label: "Sector" }],
    });
    expect(jobs).toMatchObject({
      label: "Job Position",
      plural: "Job Positions",
      filters: [{ key: "contract_type" }],
    });
  });

  it("filters the list by every chosen field, case-insensitively", () => {
    expect(matchesFilters({ sector: "Bridges", city: "Bilbao" }, { sector: "bridges" })).toBe(true);
    expect(matchesFilters({ sector: "Bridges" }, { sector: "Towers" })).toBe(false);
    expect(matchesFilters({}, {})).toBe(true);
  });

  it("makes URL slugs and refuses unsafe image URLs", () => {
    expect(slugify("Puente de Ría — Bilbao")).toBe("puente-de-ria-bilbao");
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("/local.png")).toBeNull();
    expect(safeImageUrl("https://images.example.com/a.jpg")).toBe(
      "https://images.example.com/a.jpg",
    );
  });
});
