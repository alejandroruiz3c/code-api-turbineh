import { describe, expect, it } from "vitest";
import { parseProgress } from "./verify.js";

describe("gate progress markers (ADR-0051)", () => {
  it("parses step start and end, with the passed-test count when printed", () => {
    expect(parseProgress("PROGRESS begin unit")).toEqual({ name: "unit", state: "start" });
    expect(parseProgress("PROGRESS end unit 0 5321 42")).toEqual({
      name: "unit",
      state: "done",
      ok: true,
      ms: 5321,
      tests: 42,
    });
    expect(parseProgress("PROGRESS end build 1 900 ")).toEqual({
      name: "build",
      state: "done",
      ok: false,
      ms: 900,
    });
  });

  it("ignores every other line (STEP results stay the source of truth)", () => {
    expect(parseProgress("STEP unit 0 5321")).toBeNull();
    expect(parseProgress("  ✓ tests/unit/a.test.ts (3 tests)")).toBeNull();
  });
});
