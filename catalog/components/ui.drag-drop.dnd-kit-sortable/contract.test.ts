import { describe, expect, it } from "vitest";
import { arrayMove } from "@dnd-kit/sortable";
describe("dnd-kit sortable contract", () => {
  it("reorders items", () => {
    expect(arrayMove(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });
});
