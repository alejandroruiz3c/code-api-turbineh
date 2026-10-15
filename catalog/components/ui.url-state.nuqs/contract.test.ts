import { describe, expect, it } from "vitest";
import { parseAsInteger, parseAsString, createSerializer } from "nuqs";
describe("nuqs contract", () => {
  it("parses and serialises typed URL state", () => {
    expect(parseAsInteger.parse("3")).toBe(3);
    const serialize = createSerializer({ page: parseAsInteger, q: parseAsString });
    expect(serialize("/list", { page: 2, q: "red shoes" })).toBe("/list?page=2&q=red+shoes");
  });
});
