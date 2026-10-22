import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { functionLabel, readCatalogTotals, readUseCases } from "../scripts/use-cases-source.js";
import { CATALOG_TOTALS, USE_CASES } from "./use-cases.generated.js";

/**
 * The areas shown on the home and the catalogue (ADR-0076) come from the catalogue only: each function is a canonical
 * criterion linked to a test (ADR-0063), each add-on an approved functional component of that area, the totals are
 * computed, and the one-line texts use only words the catalogue text and the proved functions already say.
 */
const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const recipesDir = join(root, "catalog/recipes");
const componentsDir = join(root, "catalog/components");
const yaml = <T>(file: string): T => parse(readFileSync(file, "utf8")) as T;
const areas = readUseCases(recipesDir);

interface Raw {
  id?: string;
  advertises?: string;
  label?: string;
  tests?: string[];
  generated?: string;
  same?: string;
  when?: string;
}
const criteriaIn = (file: string): Raw[] =>
  existsSync(file) ? (yaml<Raw[]>(file) ?? []).filter((r) => r?.id && r.advertises) : [];
const allCriteria = new Map(
  [
    ...readdirSync(recipesDir).flatMap((r) => criteriaIn(join(recipesDir, r, "criteria.yaml"))),
    ...readdirSync(componentsDir).flatMap((c) =>
      criteriaIn(join(componentsDir, c, "criteria.yaml")),
    ),
  ].map((c) => [c.id as string, c]),
);
const manifests = new Map<
  string,
  { status: string; capability: { does: string; use_cases?: string[] } }
>();
const manifest = (id: string) => {
  if (!manifests.has(id)) manifests.set(id, yaml(join(componentsDir, id, "component.yaml")));
  return manifests.get(id)!;
};

/** Words a one-liner may use: those of the catalogue text and of the proved functions (stems), plus glue words. */
const GLUE = new Set(
  "a an and the of for with to on in or by from your their its any each every that only what when who".split(
    " ",
  ),
);
const stems = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !GLUE.has(w))
    .map((w) => w.slice(0, 5));
const unsaid = (line: string, ...sources: string[]) => {
  const known = new Set(sources.flatMap(stems));
  return stems(line).filter((w) => !known.has(w));
};

describe("areas from the catalogue (ADR-0076)", () => {
  it("lists every recipe as an area, with a name and a one-line tagline", () => {
    expect(areas.map((a) => a.id)).toEqual(USE_CASES.map((u) => u.id));
    expect(areas.length).toBe(11);
    for (const a of areas) {
      expect(a.name, a.id).toMatch(/\S/);
      expect(a.tagline.length, a.id).toBeGreaterThan(10);
      expect(a.tagline.length, a.id).toBeLessThanOrEqual(100);
    }
  });

  it("every function comes from canonical criteria, each linked to a test (its own, or the one it is the same as)", () => {
    for (const a of [...areas, ...areas.flatMap((x) => x.addOns)])
      for (const f of a.functions) {
        expect(f.criteria.length, `${a.id}: ${f.label}`).toBeGreaterThan(0);
        expect(f.proof.length, `${a.id}: ${f.label} has no linked test`).toBeGreaterThan(0);
        for (const id of f.criteria) {
          const c = allCriteria.get(id);
          expect(c, id).toBeDefined();
          expect(functionLabel(c!)).toBe(f.label);
          const proof = c!.same ? allCriteria.get(c!.same) : c;
          expect((proof?.tests?.length ?? 0) + (proof?.generated ? 1 : 0), id).toBeGreaterThan(0);
        }
      }
  });

  it("no advertised function of an area is left out (AI-only functions only where the app has AI)", () => {
    for (const a of areas) {
      const ai = a.requiredComponents.some((c) => c.startsWith("ai.orchestrator."));
      const own = [
        ...criteriaIn(join(recipesDir, a.id, "criteria.yaml")),
        ...a.requiredComponents.flatMap((c) => criteriaIn(join(componentsDir, c, "criteria.yaml"))),
      ];
      const shown = new Set(a.functions.flatMap((f) => f.criteria));
      for (const c of own) expect(shown.has(c.id as string), c.id).toBe(c.when !== "ai" || ai);
    }
    const bookings = areas.find((a) => a.id === "bookings")!;
    expect(bookings.functions.map((f) => f.label)).not.toContain("Booking tools for AI assistants");
    expect(
      areas
        .find((a) => a.id === "ai-agents")!
        .addOns.find((x) => x.id === "domain.bookings.turbineh")
        ?.functions.map((f) => f.label),
    ).toContain("Booking tools for AI assistants");
  });

  it("add-ons are exactly the approved components with criteria that name the area, never one it already installs", () => {
    for (const a of areas) {
      const expected = readdirSync(componentsDir)
        .filter((c) => existsSync(join(componentsDir, c, "criteria.yaml")))
        .filter((c) => manifest(c).status === "approved")
        .filter((c) => (manifest(c).capability.use_cases ?? []).includes(a.id))
        .filter((c) => !a.requiredComponents.includes(c))
        .sort();
      expect(
        a.addOns.map((x) => x.id),
        a.id,
      ).toEqual(expected);
      for (const x of a.addOns) {
        expect(x.name, x.id).toMatch(/\S/);
        expect(x.tagline.length, x.id).toBeLessThanOrEqual(100);
        expect(x.functions.length, x.id).toBeGreaterThan(0);
      }
    }
    // The functional components added by ADR-0069…0075 are on the areas they extend.
    const on = (area: string) => areas.find((a) => a.id === area)!.addOns.map((x) => x.id);
    expect(on("bookings")).toEqual(
      expect.arrayContaining([
        "domain.reminders.turbineh",
        "messaging.sms.twilio",
        "messaging.whatsapp.meta",
        "payments.booking-deposit.turbineh",
      ]),
    );
    expect(on("ai-agents")).toEqual(
      expect.arrayContaining([
        "ai.mail-triage.turbineh",
        "ai.recommendations.turbineh",
        "email.inbox.imapflow",
      ]),
    );
    expect(on("saas-crud")).toEqual(
      expect.arrayContaining([
        "content.blog.turbineh",
        "media.screen-recording.turbineh",
        "domain.matching.turbineh",
      ]),
    );
  });

  it("taglines use only words the catalogue text and the proved functions say", () => {
    for (const a of areas) {
      const description = yaml<{ description: string }>(
        join(recipesDir, a.id, "recipe.yaml"),
      ).description;
      expect(
        unsaid(a.tagline, description, ...a.functions.map((f) => f.label)),
        `${a.id}: "${a.tagline}"`,
      ).toEqual([]);
      for (const x of a.addOns)
        expect(
          unsaid(x.tagline, manifest(x.id).capability.does, ...x.functions.map((f) => f.label)),
          `${x.id}: "${x.tagline}"`,
        ).toEqual([]);
    }
  });

  it("totals are computed from the catalogue", () => {
    const approved = readdirSync(componentsDir).filter(
      (c) =>
        existsSync(join(componentsDir, c, "component.yaml")) && manifest(c).status === "approved",
    );
    // Canonical criteria of recipes and approved components with their own linked tests.
    const proved = [
      ...readdirSync(recipesDir).flatMap((r) => criteriaIn(join(recipesDir, r, "criteria.yaml"))),
      ...approved.flatMap((p) => criteriaIn(join(componentsDir, p, "criteria.yaml"))),
    ].filter((c) => !c.same && ((c.tests?.length ?? 0) > 0 || c.generated));
    expect(readCatalogTotals(recipesDir)).toEqual({
      components: approved.length,
      useCases: 11,
      functions: proved.length,
    });
    expect(CATALOG_TOTALS).toEqual(readCatalogTotals(recipesDir));
  });
});
