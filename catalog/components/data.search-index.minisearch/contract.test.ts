import { describe, expect, it } from "vitest";
import MiniSearch from "minisearch";
describe("minisearch contract", () => {
  it("finds documents with typos and prefixes", () => {
    const ms = new MiniSearch({ fields: ["name"], storeFields: ["name"] });
    ms.addAll([{ id: 1, name: "Red running shoes" }, { id: 2, name: "Blue jacket" }]);
    expect(ms.search("runing", { fuzzy: 0.2 })[0]?.id).toBe(1);
    expect(ms.search("jack", { prefix: true })[0]?.id).toBe(2);
  });
});
