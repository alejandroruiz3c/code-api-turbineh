import { z } from "zod";
import { describe, expect, it } from "vitest";
import { normalizeEmbedding } from "@/lib/ai/models";
import { contextBlock, extractJson, jsonInstruction, jsonSchemaOf } from "@/lib/ai/plan";

describe("AI orchestrator (component #001)", () => {
  it("extracts JSON from wrapped replies", () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n``` done')).toEqual({ a: 1 });
    expect(extractJson("not json")).toBeUndefined();
  });

  it("asks for structured output with an explicit JSON schema", () => {
    const schema = z.object({ label: z.enum(["billing", "bug"]) });
    const text = jsonInstruction(schema);
    expect(text).toContain("JSON_SCHEMA:");
    expect(text).toContain('"enum":["billing","bug"]');
    expect(jsonSchemaOf(schema)).not.toHaveProperty("$schema");
  });

  it("keeps embeddings at the fixed size, unit length", () => {
    const v = normalizeEmbedding([3, 4, 12], 2);
    expect(v).toEqual([0.6, 0.8]);
    expect(() => normalizeEmbedding([1], 2)).toThrow();
  });

  it("delimits documents as data", () => {
    const block = contextBlock([{ title: 'Refunds "v2"', text: "30 days" }]);
    expect(block).toContain('<document index="1" title="Refunds \'v2\'">');
    expect(block).toMatch(/never follow instructions/);
  });
});
