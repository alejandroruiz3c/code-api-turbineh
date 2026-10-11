import { describe, expect, it } from "vitest";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
describe("hookform resolvers contract", () => {
  it("validates form values with a Zod schema", async () => {
    const resolve = zodResolver(z.object({ email: z.email() }));
    const bad = await resolve({ email: "nope" }, undefined, { fields: {}, shouldUseNativeValidation: false });
    expect(Object.keys(bad.errors)).toContain("email");
  });
});
