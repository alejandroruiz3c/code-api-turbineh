import { describe, expect, it } from "vitest";
import { publicMetrics } from "./finalize.js";

describe("delivered report metrics", () => {
  it("keeps decision counts and drops the decider model and backend", () => {
    const out = publicMetrics({
      tokens: { compiler: { input_tokens: 1, output_tokens: 2 }, decider: "input-only" },
      decider: {
        model: "decider-model",
        backend: "decider-backend",
        requests: 1,
        questions: 9,
        cached: false,
      },
      reuse: { reusedShare: 0.5 },
    });
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/decider/);
    expect(out).toMatchObject({
      tokens: { compiler: { input_tokens: 1 } },
      decisions: { requests: 1, questions: 9, cached: false },
      reuse: { reusedShare: 0.5 },
    });
  });
});
