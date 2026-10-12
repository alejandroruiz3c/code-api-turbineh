import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
describe("yaml contract", () => {
  it("parses and writes YAML safely", () => {
    const value = parse("agent: triage\nsteps:\n  - classify\n  - reply\nmax_tokens: 512\n");
    expect(value).toEqual({ agent: "triage", steps: ["classify", "reply"], max_tokens: 512 });
    expect(parse(stringify(value))).toEqual(value);
    expect(() => parse("a: !!js/function 'return 1'")).not.toThrow();
    expect(typeof parse("a: !!js/function 'return 1'").a).not.toBe("function");
  });
});
