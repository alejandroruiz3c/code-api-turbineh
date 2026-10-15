import { describe, expect, it } from "vitest";
import { selectionCacheKey } from "./cache.js";
import type { SelectionInput } from "./select.js";

const card = (id: string, text = `card of ${id}`) =>
  ({ id, card: text }) as unknown as SelectionInput["candidates"][string][number];
const input = (over: Partial<SelectionInput["app"]> = {}, cards = [card("a"), card("b")]) => ({
  app: {
    recipe: "saas-crud",
    summary: "Gym  members",
    acceptance_criteria: ["Staff can add members"],
    ...over,
  },
  candidates: { "data.dates": cards, "ui.empty": [] },
});
const key = (i: SelectionInput, version: number | string = 1) => selectionCacheKey(i, version);

describe("selection cache key", () => {
  it("ignores case, spacing and candidate order", () => {
    expect(key(input())).toBe(key(input({ summary: " gym members " }, [card("b"), card("a")])));
  });

  it("changes with the request or with any candidate card (catalog change)", () => {
    const base = key(input());
    expect(key(input({ acceptance_criteria: ["Staff can delete members"] }))).not.toBe(base);
    expect(key(input({}, [card("a"), card("b", "edited manifest")]))).not.toBe(base);
    expect(key(input({}, [card("a"), card("b"), card("c")]))).not.toBe(base);
  });

  it("changes with the decision engine's selection policy version", () => {
    expect(key(input(), 2)).not.toBe(key(input(), 1));
    expect(key(input(), "open-1")).not.toBe(key(input(), 1));
  });
});
