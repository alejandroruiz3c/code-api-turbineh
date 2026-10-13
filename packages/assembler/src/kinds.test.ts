import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specFidelitySync } from "@turbineh/compiler";
import { LEARNING_SPECS } from "@turbineh/compiler/learning-specs";
import { describe, expect, it } from "vitest";
import { acceptanceStatus, shippedRules } from "./acceptance.js";
import { generateByKind } from "./kinds.js";

const fixture = (id: string) => {
  const s = LEARNING_SPECS.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return { s, ...specFidelitySync(s.prompt, s.spec, { knownEntities: s.recipeEntities }) };
};

describe("generation by entity kind (ADR-0043)", () => {
  it("Kilnwise without a workflow component: piece CRUD with a stage timeline, limits as a settings page", () => {
    const { spec, fidelity } = fixture("tracker");
    const plan = generateByKind({
      entities: spec.entities,
      models: fidelity.entities,
      features: { csvExport: false, csvImport: false },
      sort: [],
      workflows: {},
      scope: null,
    });
    const paths = plan.files.map((f) => f.path);
    expect(plan.nav).toEqual([
      { label: "Pieces", href: "/dashboard/pieces" },
      { label: "Settings · Stage limits", href: "/dashboard/settings/stage-limits" },
    ]);
    expect(paths).toContain("src/entities/stage-events/timeline.tsx");
    expect(paths).toContain("src/db/sql/120-stage-events-append-only.sql");
    expect(paths).not.toContain("src/app/dashboard/stage-events/page.tsx");
    const actions =
      plan.files.find((f) => f.path === "src/entities/pieces/actions.ts")?.content ?? "";
    expect(actions).toContain("recordStageEvent");
    const e2e = plan.files.find((f) => f.path === "tests/e2e/pieces.spec.ts")?.content ?? "";
    expect(e2e).toContain("is recorded in its history with who and when");
    expect(e2e).toContain("cannot be changed or deleted, not even directly in the database");
  });

  it("Pixelyard: the email log gets a table and a writer, no page; the loan status is a workflow", () => {
    const { spec, fidelity } = fixture("internal-tool");
    const plan = generateByKind({
      entities: spec.entities,
      models: fidelity.entities,
      features: { csvExport: true, csvImport: false },
      sort: [],
      workflows: { LoanRequest: { key: "loan_request", field: "status" } },
      scope: null,
    });
    const paths = plan.files.map((f) => f.path);
    expect(paths).toContain("src/entities/email-logs/record.ts");
    expect(paths.some((p) => p.startsWith("src/app/dashboard/email-logs"))).toBe(false);
    const actions =
      plan.files.find((f) => f.path === "src/entities/loan-requests/actions.ts")?.content ?? "";
    expect(actions).toContain('workflow: "loan_request"');
    expect(actions).toContain("dueAt: input.endDate");
    const schema =
      plan.files.find((f) => f.path === "src/entities/loan-requests/schema.ts")?.content ?? "";
    expect(schema).not.toContain("status:");
    const route =
      plan.files.find((f) => f.path === "src/app/dashboard/loan-requests/export/route.ts")
        ?.content ?? "";
    expect(route).toContain('can(ctx.role, "export", "loan-requests")');
  });

  it("Ledgerline: messages are a section of the document request page, scoped by company", () => {
    const { spec, fidelity } = fixture("client-portal");
    const plan = generateByKind({
      entities: spec.entities.filter((e) => e.name !== "Company"),
      models: fidelity.entities,
      features: { csvExport: false, csvImport: false },
      sort: [],
      workflows: {},
      scope: { entity: "Company", label: "Company" },
    });
    const paths = plan.files.map((f) => f.path);
    expect(paths).toContain("src/entities/messages/section.tsx");
    expect(paths.some((p) => p.startsWith("src/app/dashboard/messages"))).toBe(false);
    const edit =
      plan.files.find((f) => f.path === "src/app/dashboard/document-requests/[id]/edit/page.tsx")
        ?.content ?? "";
    expect(edit).toContain("<MessageSection parentId={row.id} />");
    expect(edit).toContain("canSeeScope(ctx, row.companyId");
  });
});

describe("criteria are proved only by tests shipped in the package", () => {
  it("drops rules whose test file or title is absent, and vetoes tests that do not act as the criterion's role", () => {
    const dir = mkdtempSync(join(tmpdir(), "shipped-"));
    mkdirSync(join(dir, "tests/unit"), { recursive: true });
    writeFileSync(
      join(dir, "tests/unit/bookings.test.ts"),
      'it("allows changes only with enough notice (24 h)", () => {\n  expect(ok).toBe(true);\n});\n',
    );
    const rules = shippedRules(dir, [
      // files-ai test of domain.bookings in an app without the assistant: not shipped.
      {
        test: "tests/e2e/booking-assistant.spec.ts › refuses to cancel inside the notice period",
        covers: ["cancel"],
      },
      { test: "tests/unit/bookings.test.ts › a title that is not in the file", covers: ["notice"] },
      {
        test: "tests/unit/bookings.test.ts › allows changes only with enough notice (24 h)",
        covers: ["notice|before"],
      },
    ]);
    expect(rules.map((r) => r.test)).toEqual([
      "tests/unit/bookings.test.ts › allows changes only with enough notice (24 h)",
    ]);
    const [ok, vetoed] = acceptanceStatus(
      ["Changes need 24 hours notice.", "A manager changes a booking with notice."],
      rules,
    );
    expect(ok?.status).toBe("covered");
    expect(vetoed?.status).toBe("open");
  });
});
