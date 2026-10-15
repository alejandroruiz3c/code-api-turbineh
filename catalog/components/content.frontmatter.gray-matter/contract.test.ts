import { describe, expect, it } from "vitest";
import matter from "gray-matter";
describe("gray-matter contract", () => {
  it("splits front matter from the Markdown body", () => {
    const f = matter("---\ntitle: Hello\ntags: [a, b]\n---\n# Body");
    expect(f.data).toEqual({ title: "Hello", tags: ["a", "b"] });
    expect(f.content.trim()).toBe("# Body");
  });
});
