import { NodeHtmlMarkdown } from "node-html-markdown";

const MAX_HTML_LENGTH = 2_000_000;

/** Compact Markdown from HTML (fewer tokens than raw HTML when a page or email is sent to a model). */
export function htmlToMarkdown(html: string): string {
  if (html.length > MAX_HTML_LENGTH) throw new Error("HTML is too large");
  return NodeHtmlMarkdown.translate(html).trim();
}
