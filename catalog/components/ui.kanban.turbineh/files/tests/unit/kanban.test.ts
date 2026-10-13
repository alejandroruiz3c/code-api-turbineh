import { describe, expect, it } from "vitest";
import { isBoard, KanbanParams, kanbanConfig } from "@/kanban/config";
import { keyAction, nextColumn } from "@/kanban/keyboard";

/** Contract of ui.kanban.turbineh: params, and keyboard moves limited to the columns a card may go to. */
const COLUMNS = ["todo", "in_progress", "review", "done"];

describe("kanban board", () => {
  it("the shipped params are valid; boards are chosen per workflow", () => {
    expect(KanbanParams.safeParse(kanbanConfig).success).toBe(true);
    const cfg = { workflows: ["task"], dragAndDrop: true, highlightOverdue: true };
    expect(isBoard("task", cfg)).toBe(true);
    expect(isBoard("loan", cfg)).toBe(false);
    expect(isBoard("loan", { ...cfg, workflows: ["*"] })).toBe(true);
  });

  it("moves with the keyboard only between the columns the card may go to", () => {
    const allowed = ["in_progress"];
    expect(
      keyAction("Enter", { picked: false, home: "todo", target: "todo" }, COLUMNS, allowed),
    ).toEqual({
      type: "pick",
    });
    expect(
      keyAction("ArrowRight", { picked: true, home: "todo", target: "todo" }, COLUMNS, allowed),
    ).toEqual({ type: "target", column: "in_progress" });
    // Wraps around the allowed columns and never offers a forbidden one (review, done).
    expect(nextColumn(COLUMNS, allowed, "in_progress", 1, "todo")).toBe("todo");
    expect(
      keyAction(" ", { picked: true, home: "todo", target: "in_progress" }, COLUMNS, allowed),
    ).toEqual({ type: "drop", column: "in_progress" });
    expect(
      keyAction("Escape", { picked: true, home: "todo", target: "in_progress" }, COLUMNS, allowed),
    ).toEqual({
      type: "cancel",
    });
    // Dropping where it started is a cancel; other keys do nothing.
    expect(
      keyAction("Enter", { picked: true, home: "todo", target: "todo" }, COLUMNS, allowed),
    ).toEqual({
      type: "cancel",
    });
    expect(
      keyAction("a", { picked: true, home: "todo", target: "todo" }, COLUMNS, allowed),
    ).toBeNull();
  });
});
