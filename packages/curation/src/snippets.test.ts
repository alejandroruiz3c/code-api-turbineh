import { describe, expect, it } from "vitest";
import { HARNESS } from "./certify.js";
import { expectedExample, type SnippetOutcome } from "./snippets.js";

/** ADR-0066: `example_check.compiled.on` keeps its date while the snippet, its packages and TypeScript are unchanged. */
describe("expectedExample", () => {
  const code = 'import { x } from "pkg";\nx();\n';
  const outcome: SnippetOutcome = {
    id: "c",
    snippet: { kind: "typescript", code, from: "snippet.ts" },
    against: ["pkg@1.0.0"],
    errors: [],
    signatureErrors: [],
  };
  const compiled = { against: ["pkg@1.0.0"], typescript: HARNESS.typescript, on: "2026-10-16" };

  it("keeps the date when only the YAML block dropped the trailing newline", () => {
    const want = expectedExample(
      outcome,
      { kind: "typescript", from: "snippet.ts", compiled },
      code.trimEnd(),
      "2026-10-21",
    );
    expect(want?.check.compiled?.on).toBe("2026-10-16");
  });

  it("dates a new compile when the snippet changed", () => {
    const want = expectedExample(
      outcome,
      { kind: "typescript", from: "snippet.ts", compiled },
      "x();",
      "2026-10-21",
    );
    expect(want?.check.compiled?.on).toBe("2026-10-21");
  });
});
