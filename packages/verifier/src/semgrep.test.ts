import { describe, expect, it } from "vitest";
import { parseSemgrep } from "./verify.js";

describe("Semgrep output", () => {
  it("never treats a scan that did not complete as clean", () => {
    expect(parseSemgrep("")).toBeNull();
    expect(parseSemgrep('{"results": [{"check_id": "x"')).toBeNull();
    expect(parseSemgrep('{"errors": []}')).toBeNull();
  });

  it("reads findings from a complete result", () => {
    const out = JSON.stringify({
      results: [
        {
          check_id: "rules.turbineh.no-eval",
          path: "/src/src/app/page.tsx",
          start: { line: 3 },
          extra: { severity: "ERROR", message: "No eval" },
        },
      ],
    });
    expect(parseSemgrep(`warning before json\n${out}`)).toEqual([
      {
        rule: "turbineh.no-eval",
        severity: "ERROR",
        path: "src/app/page.tsx",
        line: 3,
        message: "No eval",
        explain: "No eval",
      },
    ]);
    expect(parseSemgrep(JSON.stringify({ results: [] }))).toEqual([]);
  });
});
