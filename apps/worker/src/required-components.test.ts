import { join } from "node:path";
import { validateParams } from "@turbineh/catalog";
import type { WiredPattern } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { requireRequirements, workflowFromBoard } from "./required-components.js";
import { loadCatalog } from "./catalog-source.js";

const repo = join(import.meta.dirname, "../../..");
const componentsDir = join(repo, "catalog/components");
const catalog = loadCatalog(componentsDir, { cards: "oneliner" });
const board = (params: Record<string, unknown>): WiredPattern => ({
  id: "kanban",
  status: "selected",
  component: "ui.kanban.turbineh",
  reason: "",
  capabilities: ["ui.kanban"],
  params,
  where: [],
  how: "",
});

describe("requirements of required components (ADR-0048)", () => {
  it("a kanban board's columns become the required workflow, valid against its params schema", () => {
    const wf = workflowFromBoard({
      entity: "Task",
      field: "status",
      columns: ["todo", "in_progress", "done"],
      highlightOverdue: true,
    });
    expect(validateParams(join(componentsDir, "domain.workflow.turbineh"), wf)).toEqual([]);
    const w = (
      wf as {
        workflows: {
          key: string;
          initial: string;
          dueDate: boolean;
          states: { key: string; final: boolean }[];
          transitions: { from: string[]; to: string }[];
        }[];
      }
    ).workflows[0]!;
    expect(w).toMatchObject({ key: "task", initial: "todo", dueDate: true });
    expect(w.states.map((s) => [s.key, s.final])).toEqual([
      ["todo", false],
      ["in_progress", false],
      ["done", true],
    ]);
    expect(w.transitions.map((t) => `${t.from[0]}→${t.to}`)).toEqual([
      "todo→in_progress",
      "in_progress→todo",
      "in_progress→done",
    ]);
    expect(workflowFromBoard({ entity: "Task", columns: ["only"] })).toBeNull();
  });

  it("requires the workflow with the request's states when the board states them, else with defaults listed as left", () => {
    const required: Record<string, string> = { "ui.kanban": "ui.kanban.turbineh" };
    const r = requireRequirements({
      required,
      catalog,
      componentsDir,
      recipe: "projects",
      patterns: [
        board({ entity: "Task", field: "status", columns: ["todo", "in_progress", "done"] }),
      ],
      parameterised: new Set(["ui.kanban.turbineh"]),
    });
    expect(Object.values(required)).toContain("domain.workflow.turbineh");
    expect(r.domains.map((d) => [d.component, d.paramsFile])).toEqual([
      ["domain.workflow.turbineh", "src/workflow/params.json"],
    ]);
    expect(r.defaults).toEqual([]);

    const bare: Record<string, string> = { "ui.kanban": "ui.kanban.turbineh" };
    const d = requireRequirements({
      required: bare,
      catalog,
      componentsDir,
      recipe: "projects",
      patterns: [],
      parameterised: new Set(),
    });
    expect(d.domains).toEqual([]);
    expect(d.defaults.map((p) => [p.id, p.reason.split(" (")[0], p.where])).toEqual([
      ["workflow", "workflow states not specified; using defaults", ["src/workflow/params.json"]],
    ]);
  });
});
