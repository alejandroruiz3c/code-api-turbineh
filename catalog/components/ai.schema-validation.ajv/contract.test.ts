import { describe, expect, it } from "vitest";
import Ajv from "ajv";
describe("ajv contract", () => {
  it("validates structured output against a JSON Schema", () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile({
      type: "object",
      properties: {
        category: { enum: ["bug", "billing", "other"] },
        priority: { type: "integer", minimum: 1, maximum: 3 },
      },
      required: ["category", "priority"],
      additionalProperties: false,
    });
    expect(validate({ category: "bug", priority: 2 })).toBe(true);
    expect(validate({ category: "spam", priority: 9, extra: 1 })).toBe(false);
    expect(validate.errors?.length).toBeGreaterThanOrEqual(3);
  });
});
