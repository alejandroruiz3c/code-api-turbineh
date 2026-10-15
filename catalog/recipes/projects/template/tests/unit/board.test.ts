import { describe, expect, it } from "vitest";
import { byUrgency, isOverdue, neighbour } from "@/server/board";

describe("board rules", () => {
  it("moves between neighbouring columns only", () => {
    expect(neighbour("todo", 1)).toBe("doing");
    expect(neighbour("todo", -1)).toBeNull();
    expect(neighbour("done", 1)).toBeNull();
  });

  it("flags overdue tasks that are not done", () => {
    expect(isOverdue("2026-01-01", "doing", "2026-01-02")).toBe(true);
    expect(isOverdue("2026-01-01", "done", "2026-01-02")).toBe(false);
    expect(isOverdue(null, "todo", "2026-01-02")).toBe(false);
  });

  it("orders my tasks by due date, then priority", () => {
    const list = [
      { dueDate: null, priority: "urgent" },
      { dueDate: "2026-02-01", priority: "low" },
      { dueDate: "2026-02-01", priority: "high" },
    ];
    expect([...list].sort(byUrgency).map((t) => t.priority)).toEqual(["high", "low", "urgent"]);
  });
});
