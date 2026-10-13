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
import { shippedDirs } from "@turbineh/catalog";
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
// The bookings recipe is built on domain.bookings (ADR-0045): its E2E titles state the criteria they prove. Every
// Sala Nueve criterion but the first (no test chooses a service and checks durations end to end) is proven, each by
// the test that exercises it.
const BOOKINGS = "domain.bookings.turbineh";
const t = (title: string) => `tests/e2e/bookings.spec.ts › ${title}`;
const PROVING = [
  null,
  t(
    "a customer books a free time on the public page without an account: provides name, email and phone, the booking is created and a confirmation email with a cancel link is sent",
  ),
  t(
    "a customer cancels the booking with the link of the confirmation email more than the notice hours before the start time; inside the notice period the link is refused",
  ),
  t(
    "a customer cannot book a slot already taken: the same time is never booked twice for one team member (double booking prevented)",
  ),
  t(
    "a staff member signs in and sees the bookings in the day and week calendar per team member (stylist, therapist…)",
  ),
  t(
    "a staff member blocks time off to make those time slots unavailable for booking; customers are no longer offered them",
  ),
  t(
    "a staff member moves an existing booking to a different time slot, then cancels it, triggering an automated email to the customer each time",
  ),
  t(
    "a staff member moves an existing booking to a different time slot, then cancels it, triggering an automated email to the customer each time",
  ),
];
const bookingsComponent = {
  capability: "domain.bookings",
  component: {
    id: BOOKINGS,
    status: "approved" as const,
    provides: ["domain.bookings"],
    pkg: { name: "turbineh/domain.bookings", version: "0.1.0" },
    license: { declared: "Apache-2.0", detected: "Apache-2.0" },
    peer: {},
    conflicts: [],
    requires: [],
  },
  why: { pBest: 1, covers: 1, risk: 0 },
};

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
    selected: [bookingsComponent],
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
  it("the booking domain's tests prove the Sala Nueve criteria their titles state, and nothing else", () => {
    // Without the component the recipe proves nothing (its old calendar rule was cited for seven criteria).
    expect(
      acceptanceStatus(
        BOOKINGS_CRITERIA,
        coverageRules({ recipesDir, recipe: "bookings", selected: [] }),
      ).map((s) => s.status),
    ).toEqual(BOOKINGS_CRITERIA.map(() => "open"));
    const statuses = acceptanceStatus(
      BOOKINGS_CRITERIA,
      coverageRules({ recipesDir, recipe: "bookings", selected: [bookingsComponent] }),
    );
    expect(statuses.map((s) => (s.tests.length ? s.tests[0] : null))).toEqual(PROVING);
  });

  it("is met only when the proving test is in the delivered package (the agent deleted it)", () => {
    const dir = bookingsPackage(BOOKINGS_CRITERIA);
    const criteria = BOOKINGS_CRITERIA.map((criterion) => ({
      criterion,
      evidence: "Not verified automatically",
      verified: false,
    }));
    const before = verifiedGuide(dir, { gate, criteria });
    expect(before?.criteria.filter((c) => c.status === "met")).toHaveLength(7);
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
          shippedDirs(join(componentsDir, id)),
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
