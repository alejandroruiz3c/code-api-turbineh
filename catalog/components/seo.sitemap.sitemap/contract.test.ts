import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { SitemapStream, streamToPromise } from "sitemap";
describe("sitemap contract", () => {
  it("builds an XML sitemap", async () => {
    const s = new SitemapStream({ hostname: "https://example.com" });
    const xml = (await streamToPromise(Readable.from([{ url: "/about", changefreq: "monthly" }]).pipe(s))).toString();
    expect(xml).toContain("<loc>https://example.com/about</loc>");
  });
});
