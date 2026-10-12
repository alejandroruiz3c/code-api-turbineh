import { describe, expect, it } from "vitest";
import { parse } from "partial-json";
describe("partial-json contract", () => {
  it("parses JSON that is still streaming", () => {
    expect(parse('{"title": "Weekly summary", "items": [1, 2')).toEqual({
      title: "Weekly summary",
      items: [1, 2],
    });
    expect(parse('{"title": "Week')).toEqual({ title: "Week" });
  });
});
