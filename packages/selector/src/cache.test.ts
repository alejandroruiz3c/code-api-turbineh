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

describe("selection cache key", () => {
  it("ignores case, spacing and candidate order", () => {
    expect(selectionCacheKey(input())).toBe(
      selectionCacheKey(input({ summary: " gym members " }, [card("b"), card("a")])),
    );
  });

  it("changes with the request or with any candidate card (catalog change)", () => {
    const base = selectionCacheKey(input());
    expect(
      selectionCacheKey(input({ acceptance_criteria: ["Staff can delete members"] })),
    ).not.toBe(base);
    expect(selectionCacheKey(input({}, [card("a"), card("b", "edited manifest")]))).not.toBe(base);
    expect(selectionCacheKey(input({}, [card("a"), card("b"), card("c")]))).not.toBe(base);
  });
});
