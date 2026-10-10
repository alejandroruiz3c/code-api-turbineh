import { describe, expect, it } from "vitest";
import { PAGE_SIZE, parsePage, parseQuery } from "@/lib/pagination";

describe("pagination", () => {
  it("defaults and bounds the page", () => {
    expect(parsePage(undefined)).toEqual({ page: 1, offset: 0, limit: PAGE_SIZE });
    expect(parsePage("3").offset).toBe(2 * PAGE_SIZE);
    expect(parsePage("-1").page).toBe(1);
    expect(parsePage("abc").page).toBe(1);
  });
  it("trims and bounds the search query", () => {
    expect(parseQuery(["  hi  "])).toBe("hi");
    expect(parseQuery("x".repeat(500))).toHaveLength(100);
  });
});
