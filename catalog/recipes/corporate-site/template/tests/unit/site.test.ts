import { describe, expect, it } from "vitest";
import { slugify, xml } from "@/lib/text";

// The blog's Markdown renderer and helpers are tested with content.blog.turbineh (tests/unit/blog.test.ts).
describe("corporate site rules", () => {
  it("builds slugs and escapes XML", () => {
    expect(slugify("Hello, Señor Wörld!")).toBe("hello-senor-world");
    expect(xml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});
