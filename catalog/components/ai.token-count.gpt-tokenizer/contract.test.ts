import { describe, expect, it } from "vitest";
import { decode, encode, isWithinTokenLimit } from "gpt-tokenizer";
describe("gpt-tokenizer contract", () => {
  it("encodes, decodes and checks a token budget", () => {
    const text = "Summarise the attached contract in three bullet points.";
    const tokens = encode(text);
    expect(tokens.length).toBeGreaterThan(5);
    expect(decode(tokens)).toBe(text);
    expect(isWithinTokenLimit(text, 1000)).toBe(tokens.length);
    expect(isWithinTokenLimit(text, 2)).toBe(false);
  });
});
