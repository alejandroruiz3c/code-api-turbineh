import { describe, expect, it } from "vitest";
import { jsonrepair } from "jsonrepair";
describe("jsonrepair contract", () => {
  it("repairs typical model JSON mistakes", () => {
    const raw = "```json\n{name: 'Ana', tags: ['vip',], active: True}\n```";
    expect(JSON.parse(jsonrepair(raw))).toEqual({ name: "Ana", tags: ["vip"], active: true });
  });

  it("throws on text that cannot be JSON", () => {
    expect(() => jsonrepair("{")).not.toThrow();
    expect(() => jsonrepair("}{")).toThrow();
  });
});
