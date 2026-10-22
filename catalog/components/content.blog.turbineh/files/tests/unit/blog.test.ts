import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlogParams, blogConfig } from "@/blog/config";
import { Markdown, safeHref } from "@/blog/markdown";
import {
  excerptOf,
  isSlug,
  jsonLd,
  likePattern,
  parseFrontmatter,
  parseTags,
  readingMinutes,
  slugify,
  wordCount,
  xml,
} from "@/blog/text";

describe("blog (content.blog.turbineh)", () => {
  it("reading time is the post's words divided by the words per minute, rounded up, at least one minute", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
    expect(wordCount("# Title\n\nSome **bold** text with a [link](https://example.com).")).toBe(7);
    expect(readingMinutes(words(200), 200)).toBe(1);
    expect(readingMinutes(words(201), 200)).toBe(2);
    expect(readingMinutes(words(1000), 250)).toBe(4);
    expect(readingMinutes("", 200)).toBe(1);
    expect(readingMinutes(words(blogConfig.wordsPerMinute * 3), blogConfig.wordsPerMinute)).toBe(3);
  });

  it("parses Markdown frontmatter (title, slug, excerpt, author, tags, status) and keeps the body without it", () => {
    const fm = parseFrontmatter(
      '---\ntitle: "Attention, explained"\nslug: attention-explained\nexcerpt: A short summary\nauthor: Ada Writer\ntags: [Transformers, research, transformers]\nstatus: draft\nlayout: wide\n---\n\n# Hello\n\nBody text.',
    );
    expect(fm.data).toEqual({
      title: "Attention, explained",
      slug: "attention-explained",
      excerpt: "A short summary",
      author: "Ada Writer",
      tags: ["Transformers", "research"],
      status: "draft",
    });
    expect(fm.body).toBe("# Hello\n\nBody text.");
    expect(fm.unknown).toEqual(["layout"]);
    const list = parseFrontmatter("---\ntags:\n  - one\n  - two\n---\nText here");
    expect(list.data.tags).toEqual(["one", "two"]);
    expect(parseFrontmatter("No frontmatter here\n---\nx").data).toEqual({});
    expect(parseFrontmatter("No frontmatter here").body).toBe("No frontmatter here");
  });

  it("tags are trimmed, de-duplicated by slug and limited to ten", () => {
    expect(parseTags(" AI ,ai, Machine Learning,, ")).toEqual([
      { name: "AI", slug: "ai" },
      { name: "Machine Learning", slug: "machine-learning" },
    ]);
    expect(parseTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10);
  });

  it("renders Markdown without executing HTML and only allows safe link targets", () => {
    const html = renderToString(
      Markdown({ source: "# Title\n\n**Bold** <script>alert(1)</script>\n\n- one\n- two" }),
    );
    expect(html).toContain("<h2");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
  });

  it("escapes XML for the RSS feed and JSON-LD for script tags; slugs are URL-safe", () => {
    expect(xml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    expect(jsonLd({ headline: "</script><script>" })).not.toContain("</script>");
    expect(slugify("Hello, Señor Wörld!")).toBe("hello-senor-world");
    expect(isSlug("hello-world")).toBe(true);
    expect(isSlug("../etc/passwd")).toBe(false);
    expect(isSlug("Hello")).toBe(false);
  });

  it("a keyword search treats wildcards as text; excerpts end at a word", () => {
    expect(likePattern("100%_done\\")).toBe("%100\\%\\_done\\\\%");
    expect(excerptOf("word ".repeat(100), 30).endsWith("…")).toBe(true);
    expect(excerptOf("Short text.")).toBe("Short text.");
  });

  it("validates the request's parameters", () => {
    expect(
      BlogParams.safeParse({ postsPerPage: 10, wordsPerMinute: 200, feedItems: 20 }).success,
    ).toBe(true);
    expect(
      BlogParams.safeParse({ postsPerPage: 0, wordsPerMinute: 200, feedItems: 20 }).success,
    ).toBe(false);
  });
});
