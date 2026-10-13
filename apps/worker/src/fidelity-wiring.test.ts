import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateParams } from "@turbineh/catalog";
import { LEARNING_SPECS } from "@turbineh/compiler/learning-specs";
import { describe, expect, it } from "vitest";
import { wireFidelitySync } from "./fidelity-wiring.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const componentsDir = join(repoRoot, "catalog/components");
const spec = (id: string) => {
  const s = LEARNING_SPECS.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};
const wire = (id: string, dir = componentsDir, recipeChain = [spec(id).spec.recipe, "saas-crud"]) =>
  wireFidelitySync(spec(id).prompt, spec(id).spec, {
    recipeId: spec(id).spec.recipe,
    recipeChain,
    componentsDir: dir,
    knownEntities: spec(id).recipeEntities,
  });

describe("spec fidelity wired to the catalog (ADR-0044)", { timeout: 60_000 }, () => {
  it("selects only approved components whose params satisfy their params.schema.json", () => {
    for (const s of LEARNING_SPECS) {
      const w = wire(s.id);
      for (const sel of w.wired.selected)
        if (sel.component !== "domain.bookings.turbineh")
          expect(
            validateParams(join(componentsDir, sel.component), sel.params),
            `${s.id} ${sel.component}`,
          ).toEqual([]);
    }
  });

  it("Fieldnote: membership-access with owner/editor/viewer and the audit log; tags fold into Note", () => {
    const w = wire("saas-crud");
    expect(w.wired.patterns.map((p) => [p.id, p.status])).toEqual([
      ["membership-access", "selected"],
      ["audit-log", "selected"],
    ]);
    const m = w.wired.selected.find((x) => x.id === "membership-access")?.params as {
      roles: { key: string; can: string[] }[];
      defaultRole: string;
    };
    expect(m.roles.map((r) => r.key)).toEqual(["owner", "editor", "viewer"]);
    expect(m.roles.find((r) => r.key === "viewer")?.can).toEqual(["read", "see_all_scopes"]);
    expect(m.defaultRole).toBe("viewer");
    expect(w.spec.entities.map((e) => e.name)).toEqual(["Note", "WorkspaceMember"]);
    expect(w.spec.capabilities).toContain("data.csv-export");
  });

  it("Pixelyard: a loan workflow approved by managers (stored as owner/admin), with due dates", () => {
    const w = wire("internal-tool");
    const wf = (
      w.wired.selected.find((x) => x.id === "workflow")?.params as {
        workflows: {
          key: string;
          dueDate: boolean;
          transitions: { to: string; roles: string[] }[];
        }[];
      }
    ).workflows[0];
    expect(wf?.key).toBe("loan_request");
    expect(wf?.dueDate).toBe(true);
    expect(wf?.transitions.find((t) => t.to === "approved")?.roles).toEqual(["owner", "admin"]);
    // The overdue emails are a scheduled job (jobs.scheduled.turbineh, ADR-0048): its kind is inferred from the words.
    const jobs = w.wired.selected.find((x) => x.id === "jobs.scheduled");
    expect(jobs?.component).toBe("jobs.scheduled.turbineh");
    expect(validateParams(join(componentsDir, "jobs.scheduled.turbineh"), jobs?.params)).toEqual(
      [],
    );
  });

  it("patterns without a component stay missing with where to implement them", () => {
    // A catalog without the components of ADR-0048: Brickline's board, attachments and overdue emails stay missing.
    const dir = mkdtempSync(join(tmpdir(), "catalog-"));
    cpSync(componentsDir, dir, { recursive: true });
    for (const id of [
      "ui.kanban.turbineh",
      "storage.private-uploads.turbineh",
      "jobs.scheduled.turbineh",
    ])
      rmSync(join(dir, id), { recursive: true });
    const w = wire("projects", dir);
    const missing = w.wired.patterns.filter((p) => p.status === "missing");
    expect(missing.map((p) => p.id).sort()).toEqual([
      "jobs.scheduled",
      "kanban",
      "private-uploads",
    ]);
    for (const p of missing) expect(p.where.length).toBeGreaterThan(0);
  });

  it("does not select a component for a recipe it is not declared for", () => {
    // domain.bookings is declared for the bookings recipe (ADR-0048): selected with the request's params.
    const w = wire("bookings");
    expect(w.wired.patterns.find((p) => p.id === "bookings")).toMatchObject({
      status: "selected",
      component: "domain.bookings.turbineh",
    });
    // The same component declared only for ai-agents is not selected for the bookings recipe.
    const dir = mkdtempSync(join(tmpdir(), "catalog-"));
    cpSync(componentsDir, dir, { recursive: true });
    for (const f of ["component.yaml", "guide.yaml"]) {
      const file = join(dir, "domain.bookings.turbineh", f);
      writeFileSync(
        file,
        readFileSync(file, "utf8").replaceAll("[ai-agents, bookings]", "[ai-agents]"),
      );
    }
    expect(wire("bookings", dir).wired.patterns.find((p) => p.id === "bookings")).toMatchObject({
      status: "missing",
    });
  });

  it("picks up a new component automatically when it appears in the catalog (existence + schema)", () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-"));
    cpSync(componentsDir, dir, { recursive: true });
    const id = "ui.kanban.turbineh";
    mkdirSync(join(dir, id, "files/src/kanban"), { recursive: true });
    writeFileSync(
      join(dir, id, "component.yaml"),
      [
        `id: ${id}`,
        "status: approved",
        "capability: { use_cases: [projects, tracker] }",
        "relations: { provides: [ui.kanban] }",
        "params: { file: src/kanban/params.json, schema: params.schema.json, entities: [Board] }",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, id, "params.schema.json"),
      JSON.stringify({
        type: "object",
        required: ["entity", "columns"],
        properties: { entity: { type: "string" }, columns: { type: "array", minItems: 2 } },
      }),
    );
    writeFileSync(
      join(dir, id, "files/src/kanban/params.json"),
      JSON.stringify({ entity: "Task", columns: ["a", "b"] }),
    );
    const w = wire("tracker", dir, ["tracker", "saas-crud"]);
    expect(w.wired.patterns.find((p) => p.id === "kanban")).toMatchObject({
      status: "selected",
      component: id,
    });
    const sel = w.wired.selected.find((x) => x.component === id);
    expect(sel?.paramsFile).toBe("src/kanban/params.json");
    expect(sel?.providedEntities).toContain("Board");
    // A schema the generated params cannot satisfy keeps the pattern missing.
    writeFileSync(
      join(dir, id, "params.schema.json"),
      JSON.stringify({
        type: "object",
        required: ["swimlanes"],
        additionalProperties: false,
        properties: { swimlanes: { type: "array" } },
      }),
    );
    expect(
      wire("tracker", dir, ["tracker", "saas-crud"]).wired.patterns.find((p) => p.id === "kanban")
        ?.status,
    ).toBe("missing");
  });
});
