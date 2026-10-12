import { describe, expect, it } from "vitest";
import pgvector from "pgvector";
describe("pgvector contract", () => {
  it("serialises embeddings to and from the pgvector SQL format", () => {
    expect(pgvector.toSql([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
    expect(pgvector.fromSql("[1,2,3]")).toEqual([1, 2, 3]);
  });
});
