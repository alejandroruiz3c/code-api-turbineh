import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptanceStatus } from "./acceptance.js";
import { entityCoverage } from "./assemble.js";
import { generateEntity } from "./entities.js";

/**
 * Regression (ADR-0039 §4): production build f195341c (Fieldnote, saas-crud) marked these criteria "met" with generated
 * CRUD tests that do not prove them. Each must come out "open"; the true proofs stay "met".
 */
const ENTITIES = [
  {
    name: "Note",
    fields: [
      { name: "title", type: "string" as const, required: true },
      { name: "body", type: "text" as const, required: true },
    ],
  },
  {
    name: "WorkspaceMember",
    fields: [{ name: "email", type: "string" as const, required: true }],
  },
];

function generatedApp(): string {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-proof-"));
  for (const e of ENTITIES)
    for (const f of generateEntity(e, { csvExport: true, csvImport: true }, ENTITIES)) {
      const p = join(dir, f.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.content);
    }
  return dir;
}

describe("generated tests prove only what they exercise", () => {
  const rules = entityCoverage(
    generatedApp(),
    ENTITIES.map((e) => e.name),
  );

  it("the four production false matches (and two more from the same build) are open", () => {
    const falseMatches = [
      "Given a viewer, when they attempt to edit a note, the system denies the request.",
      "Given an owner, when they invite a teammate via email, the teammate is assigned the specified role (owner, editor, or viewer).",
      "Given a change to any note, when an owner views the audit log, the change is recorded and visible.",
      "Given the notes list, when a user searches by text, the list updates to show only matching notes.",
      "Given the notes list, when a tag filter is applied, the list updates to show only notes containing that tag.",
      "Given a new user, when they sign up, a workspace is created and they are assigned the 'owner' role.",
    ];
    expect(rules.length).toBeGreaterThan(0);
    const statuses = acceptanceStatus(falseMatches, rules, true);
    expect(statuses.map((s) => [s.status, s.tests])).toEqual(falseMatches.map(() => ["open", []]));
  });

  it("criteria the generated tests do exercise stay met", () => {
    const statuses = acceptanceStatus(
      ["Owner can create a note.", "Users can edit a note.", "Notes can be exported as CSV."],
      rules,
      true,
    );
    expect(statuses.map((s) => s.status)).toEqual(["met", "met", "met"]);
  });
});
