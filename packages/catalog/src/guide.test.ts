import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guideErrors, guideMarkdown, readGuides } from "./guide.js";

const components = join(import.meta.dirname, "../../../catalog/components");

describe("component guides (ADR-0033)", () => {
  it("the shipped guides are complete and every guarantee points to a real test", () => {
    for (const id of ["ai.orchestrator.turbineh", "domain.bookings.turbineh"])
      expect(guideErrors(join(components, id), id)).toEqual([]);
    const [g] = readGuides(join(components, "domain.bookings.turbineh"));
    const md = guideMarkdown(g!);
    for (const h of [
      "## Use it when",
      "## Do not use it when",
      "## Extension points",
      "## Guarantees",
      "## Minimal example",
    ])
      expect(md).toContain(h);
  });

  it("rejects incomplete guides and guarantees without a shipped test", () => {
    const dir = mkdtempSync(join(tmpdir(), "guide-"));
    mkdirSync(join(dir, "files/tests"), { recursive: true });
    writeFileSync(join(dir, "files/tests/a.test.ts"), 'it("works", () => {});\n');
    writeFileSync(
      join(dir, "guide.yaml"),
      [
        "schema: turbineh.guide/v0.1",
        "component: x.y.z",
        "title: T",
        "guarantees:",
        '  - { claim: "a", test: "tests/a.test.ts › works" }',
        '  - { claim: "b", test: "tests/a.test.ts › missing title" }',
        '  - { claim: "c", test: "tests/none.test.ts" }',
      ].join("\n"),
    );
    const errors = guideErrors(dir, "x.y.z").join("\n");
    expect(errors).toContain('"summary" is required');
    expect(errors).toContain('"missing title" not found');
    expect(errors).toContain("tests/none.test.ts, not shipped");
    expect(errors).not.toContain('"works" not found');
  });
});
