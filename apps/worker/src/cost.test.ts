import { describe, expect, it } from "vitest";
import { buildCost } from "./cost.js";

describe("build cost", () => {
  it("prices every tracked model call and adds the overhead", () => {
    const c = buildCost(
      {
        tokens: { compiler: { input_tokens: 1_000_000, output_tokens: 0 } },
        integrated: [{ usage: { input_tokens: 0, output_tokens: 1_000_000 } }],
        backup: {
          activations: [
            {
              model: "deepseek-v4-flash-0731",
              usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
            },
          ],
        },
        corrections: [
          { by: "unknown-model", usage: { input_tokens: 0, output_tokens: 1_000_000 } },
        ],
      },
      "gemma-4-26b-a4b-it",
      0.01,
    );
    // 0.25 (compiler in) + 0.5 (glue out) + 1.2 (backup) + 5.5 (unknown model priced at the highest rate)
    expect(c.trackedEur).toBe(7.45);
    expect(c.totalEur).toBe(7.46);
  });

  it("costs only the overhead when nothing was metered", () => {
    expect(buildCost({}, "gemma-4-26b-a4b-it", 0.01).totalEur).toBe(0.01);
  });
});
