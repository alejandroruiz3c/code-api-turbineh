import { describe, expect, it } from "vitest";
import { ulid, decodeTime } from "ulid";
describe("ulid contract", () => {
  it("creates time-sortable ids", () => {
    const id = ulid(1_700_000_000_000);
    expect(id).toHaveLength(26);
    expect(decodeTime(id)).toBe(1_700_000_000_000);
  });
});
