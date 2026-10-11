import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Markdown, safeHref } from "@/lib/markdown";
import { slugify, xml } from "@/lib/text";

describe("corporate site rules", () => {
  it("renders Markdown without executing HTML", () => {
    const html = renderToString(
      Markdown({ source: "# Title\n\n**Bold** <script>alert(1)</script>\n\n- one\n- two" }),
    );
    expect(html).toContain("<h2");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<li>one</li>");
  });

  it("only allows safe link targets", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("/about")).toBe("/about");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
  });

  it("builds slugs and escapes XML", () => {
    expect(slugify("Hello, Señor Wörld!")).toBe("hello-senor-world");
    expect(xml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});
