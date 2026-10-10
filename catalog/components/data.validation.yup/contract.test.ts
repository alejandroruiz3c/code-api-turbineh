import { describe, expect, it } from "vitest";
import { number, object, string } from "yup";
describe("yup contract", () => {
  it("validates and casts", async () => {
    const schema = object({ name: string().required(), qty: number().min(1).required() });
    await expect(schema.validate({ name: "x", qty: "2" })).resolves.toEqual({ name: "x", qty: 2 });
    await expect(schema.validate({ name: "", qty: 0 })).rejects.toThrow();
  });
});
