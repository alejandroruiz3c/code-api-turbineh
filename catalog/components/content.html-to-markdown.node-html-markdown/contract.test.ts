import { describe, expect, it } from "vitest";
import { NodeHtmlMarkdown } from "node-html-markdown";
describe("node-html-markdown contract", () => {
  it("converts HTML to compact Markdown", () => {
    const md = NodeHtmlMarkdown.translate(
      '<h1>Pricing</h1><p>Plans start at <strong>9 EUR</strong>. <a href="https://x.test/p">Details</a></p><ul><li>One</li><li>Two</li></ul>',
    );
    expect(md).toContain("# Pricing");
    expect(md).toContain("**9 EUR**");
    expect(md).toContain("[Details](https://x.test/p)");
    expect(md).toMatch(/\* One|- One/);
  });
});
