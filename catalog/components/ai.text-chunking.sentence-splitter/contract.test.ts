import { describe, expect, it } from "vitest";
import { split, SentenceSplitterSyntax } from "sentence-splitter";
describe("sentence-splitter contract", () => {
  it("splits text into sentences", () => {
    const nodes = split("We shipped the order. It arrived on Monday! Was it damaged? No.");
    const sentences = nodes
      .filter((n) => n.type === SentenceSplitterSyntax.Sentence)
      .map((n) => n.raw.trim());
    expect(sentences).toEqual([
      "We shipped the order.",
      "It arrived on Monday!",
      "Was it damaged?",
      "No.",
    ]);
  });
});
