import { describe, expect, it } from "vitest";
import { Feed } from "feed";
describe("feed contract", () => {
  it("renders an RSS 2.0 document with items", () => {
    const f = new Feed({
      title: "Blog",
      id: "https://example.com",
      link: "https://example.com",
      copyright: "©",
    });
    f.addItem({
      title: "First post",
      link: "https://example.com/p/1",
      date: new Date("2026-01-01"),
    });
    const xml = f.rss2();
    expect(xml).toContain("<rss");
    expect(xml).toContain("First post");
  });
});
