import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildSpec } from "@turbineh/compiler";
import { HELP_EXAMPLES, isProductQuestion, summarizeUseCase, USE_CASES } from "@turbineh/engine";
import { describe, expect, it } from "vitest";
import { EXAMPLE_FIXTURES, type ExampleFixture } from "./example-prompts.fixtures.js";
import { gateOffline } from "./gate-offline.js";

/**
 * Guard (ADR-0069): no example prompt TurbineH shows can be refused by its own scope gate again. Production refused the
 * wizard's "support assistant" suggestion and the catalogue's own use-case examples with "0 % functional coverage".
 * Every example we show — the wizard's suggestions, each use case's example (Discover, /use, the product-question
 * help), the README's and the API page's — must have a compiled fixture, pass the gate as the worker runs it (code
 * only: no decision engine), and have every functional requirement proved by a shipped test unless the fixture lists
 * it as open with a reason.
 */
const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** The wizard's suggestions (apps/web/src/components/flow-wizard.tsx, `const NEEDS = [...]`). */
function wizardNeeds(): string[] {
  const src = read("apps/web/src/components/flow-wizard.tsx");
  const block = /const NEEDS = \[([\s\S]*?)\];/.exec(src)?.[1] ?? "";
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

/** Example prompts in the README and the API page (`"prompt":"…"`, `"need":"…"`) and the home page's "e.g." hint. */
function docExamples(): string[] {
  const out: string[] = [];
  for (const file of ["README.md", "apps/web/src/app/use/page.tsx"])
    for (const m of read(file).matchAll(/"(?:prompt|need)"\s*:\s*"([^"]{12,})"/g))
      out.push(m[1] as string);
  const hint = /placeholder="What do you need\? e\.g\. ([^"]+)"/.exec(
    read("apps/web/src/app/page.tsx"),
  );
  if (hint?.[1]) out.push(hint[1]);
  return out;
}

const EXAMPLES = [
  ...new Set([
    ...wizardNeeds(),
    ...USE_CASES.map((u) => summarizeUseCase(u).example),
    ...HELP_EXAMPLES.map((e) => e.prompt),
    ...docExamples(),
  ]),
];

const toSpec = (x: ExampleFixture): BuildSpec =>
  ({
    recipe: x.recipe,
    out_of_scope_reason: null,
    closest_recipe: null,
    app_name: x.app_name,
    slug: "example",
    summary: x.summary,
    roles: x.roles,
    entities: x.entities,
    pages: [{ path: "/", purpose: "Home page", auth_required: false }],
    capabilities: ["security.headers"],
    acceptance_criteria: [...x.acceptance_criteria],
  }) as BuildSpec;

describe("every example prompt we show is covered by the scope gate (ADR-0069)", () => {
  it("collects the examples from every surface", () => {
    expect(wizardNeeds().length).toBeGreaterThanOrEqual(3);
    expect(USE_CASES.length).toBeGreaterThanOrEqual(11);
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(15);
  });

  it.each(EXAMPLES)("has a compiled fixture: %s", (prompt) => {
    expect(
      EXAMPLE_FIXTURES.some((x) => x.prompt === prompt),
      `add the compiled spec of this example to example-prompts.fixtures.ts: ${prompt}`,
    ).toBe(true);
  });

  it.each(EXAMPLE_FIXTURES.map((x) => [x.prompt.slice(0, 70), x] as const))(
    "covered: %s",
    async (_, x) => {
      expect(isProductQuestion(x.prompt), "an example is a request, never a product question").toBe(
        false,
      );
      const { spec, proven, verdict } = await gateOffline(x.prompt, toSpec(x), root);
      expect(verdict.notCovered, x.prompt).toEqual([]);
      expect(verdict.status).toBe("covered");
      const unproven = spec.acceptance_criteria.filter((c) => !proven.has(c));
      expect(
        unproven.filter((c) => !x.open?.[c]),
        `requirements of an example no shipped test proves (prove them, or list them in \`open\` with the reason): ${unproven.filter((c) => !x.open?.[c]).join(" | ")}`,
      ).toEqual([]);
    },
  );
});
