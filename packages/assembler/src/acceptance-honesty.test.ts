import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import {
  acceptanceStatus,
  attachProofs,
  readCoverage,
  sourceIn,
  testBlocks,
} from "./acceptance.js";
import { readAcceptanceJson, verifiedGuide } from "./agent-guide.js";
import { assemble, coverageRules } from "./assemble.js";
import { recipeChain } from "./recipes.js";

/** Hand-written acceptance.yaml rules go through proofVerdict (ADR-0043, learning round G3). */
const catalog = join(__dirname, "../../../catalog");
const recipesDir = join(catalog, "recipes");
const componentsDir = join(catalog, "components");

// The bookings package of the learning round (Sala Nueve, build f336da58): the compiler's criteria. Its rule
// "the owner books a slot and sees it in the calendar" was cited for seven of them.
const BOOKINGS_CRITERIA = [
  "Given a customer selects a service, they can only choose time slots that match the service duration.",
  "Given a customer provides a name, email, and phone, the system creates a booking and sends a confirmation email.",
  "Given a customer receives a confirmation email, they can click the link to cancel the booking if it is more than 12 hours before the start time.",
  "Given a customer attempts to book a slot that is already taken, the system prevents the double booking.",
  "Given a staff member signs in, they can view a calendar displaying bookings for the day and week per stylist.",
  "Given a staff member is authenticated, they can block specific time slots to make them unavailable for booking.",
  "Given a staff member is authenticated, they can move an existing booking to a different time slot.",
  "Given a staff member is authenticated, they can cancel a booking, triggering an automated email to the customer.",
];
// What the shipped bookings tests do prove.
const PROVEN = [
  "The owner books a slot and sees it in the calendar.",
  "A booking outside the opening hours is rejected.",
];

const spec = (criteria: string[]): BuildSpec => ({
  recipe: "bookings",
  out_of_scope_reason: null,
  closest_recipe: null,
  app_name: "Sala Nueve",
  slug: "sala-nueve",
  summary: "Bookings for a hair salon.",
  roles: ["owner"],
  entities: [],
  pages: [{ path: "/", purpose: "Home", auth_required: false }],
  capabilities: ["security.headers", "data.validation"],
  acceptance_criteria: criteria,
});

function bookingsPackage(criteria: string[]): string {
  const outDir = join(mkdtempSync(join(tmpdir(), "honesty-")), "app");
  assemble({
    buildId: "b-g3",
    recipesDir,
    recipe: "bookings",
    outDir,
    spec: spec(criteria),
    selected: [],
    gaps: [],
  });
  return outDir;
}

const gate = {
  ok: true,
  verifiedAt: "2026-10-13T00:00:00.000Z",
  environment: "sandbox" as const,
  steps: [],
  findings: [],
};

describe("criteria honesty for hand-written acceptance rules", () => {
  it("the bookings calendar test proves none of the seven criteria it was cited for", () => {
    const statuses = acceptanceStatus(
      [...BOOKINGS_CRITERIA, ...PROVEN],
      coverageRules({ recipesDir, recipe: "bookings", selected: [] }),
    );
    expect(statuses.slice(0, BOOKINGS_CRITERIA.length).map((s) => s.status)).toEqual(
      BOOKINGS_CRITERIA.map(() => "open"),
    );
    expect(statuses.slice(BOOKINGS_CRITERIA.length).map((s) => s.tests)).toEqual([
      ["tests/e2e/bookings.spec.ts › the owner books a slot and sees it in the calendar"],
      ["tests/e2e/bookings.spec.ts › a booking outside the opening hours is rejected"],
    ]);
  });

  it("is met only when the proving test is in the delivered package (the agent deleted it)", () => {
    const dir = bookingsPackage([...BOOKINGS_CRITERIA, ...PROVEN]);
    const criteria = [...BOOKINGS_CRITERIA, ...PROVEN].map((criterion) => ({
      criterion,
      evidence: "Not verified automatically",
      verified: false,
    }));
    const before = verifiedGuide(dir, { gate, criteria });
    expect(before?.criteria.filter((c) => c.status === "met").map((c) => c.text)).toEqual(PROVEN);
    // What the learning-round agent did: it replaced tests/e2e/bookings.spec.ts with its own specs.
    rmSync(join(dir, "tests/e2e/bookings.spec.ts"));
    const after = verifiedGuide(dir, { gate, criteria });
    expect(after?.criteria.filter((c) => c.status === "met")).toEqual([]);
    expect(readAcceptanceJson(dir).every((c) => c.status === "open")).toBe(true);
  });

  it("every rule of every recipe and component names a test its sources ship (none is dropped)", () => {
    const sources: [string, string[]][] = [
      ...readdirSync(recipesDir)
        .filter((id) => existsSync(join(recipesDir, id, "acceptance.yaml")))
        .map((id): [string, string[]] => [
          join(recipesDir, id, "acceptance.yaml"),
          recipeChain(recipesDir, id)
            .reverse()
            .map((m) => join(recipesDir, m.id, "template")),
        ]),
      ...readdirSync(componentsDir)
        .filter((id) => existsSync(join(componentsDir, id, "acceptance.yaml")))
        .map((id): [string, string[]] => [
          join(componentsDir, id, "acceptance.yaml"),
          [join(componentsDir, id, "files"), join(componentsDir, id, "files-ai")],
        ]),
    ];
    expect(sources.length).toBeGreaterThan(10);
    for (const [file, dirs] of sources) {
      const rules = readCoverage(file, file);
      const proven = attachProofs(rules, sourceIn(...dirs));
      expect(
        rules.filter((r) => !proven.some((p) => p.test === r.test)).map((r) => r.test),
        file,
      ).toEqual([]);
      // Each proof is the shipped test: its title and its key assertions.
      for (const p of proven) expect(p.proof?.title).toBe(p.test.split(" › ")[1]);
    }
  });

  it("reads titles and assertions of Playwright and Vitest tests in any quote style", () => {
    const blocks = testBlocks(
      [
        'test("the owner books a slot", async ({ page }) => {',
        '  await expect(page.getByRole("status")).toContainText("Booking confirmed");',
        "});",
        "it('rejects past bookings', () => {",
        "  expect(validate(past)).toBe(false);",
        "});",
        "test.describe(`group`, () => {});",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      {
        title: "the owner books a slot",
        assertions: ['await expect(page.getByRole("status")).toContainText("Booking confirmed");'],
      },
      { title: "rejects past bookings", assertions: ["expect(validate(past)).toBe(false);"] },
    ]);
  });
});
