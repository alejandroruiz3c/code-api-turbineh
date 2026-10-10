import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
describe("markdown-it contract", () => {
  it("escapes raw html by default", () => {
    const md = new MarkdownIt();
    expect(md.render("<script>x</script> *a*")).not.toContain("<script>");
    expect(md.render("*a*")).toContain("<em>a</em>");
  });
});
