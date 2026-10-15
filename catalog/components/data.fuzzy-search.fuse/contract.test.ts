import { describe, expect, it } from "vitest";
import Fuse from "fuse.js";
describe("fuse.js contract", () => {
  it("finds approximate matches", () => {
    const fuse = new Fuse([{ name: "Physiotherapy" }, { name: "Dentistry" }], { keys: ["name"] });
    expect(fuse.search("physio")[0]?.item.name).toBe("Physiotherapy");
  });
});
