import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import Markdown from "react-markdown";
describe("react-markdown contract", () => {
  it("renders Markdown and does not execute raw HTML", () => {
    const html = renderToString(h(Markdown, null, "# Title\n\n<script>alert(1)</script>"));
    expect(html).toContain("<h1>Title</h1>");
    expect(html).not.toContain("<script>");
  });
});
