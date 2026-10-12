import { parseHTML } from "linkedom";

const MAX_HTML_LENGTH = 2_000_000;

/** Server-side DOM for HTML (scripts are never executed). */
export function parseHtmlDocument(html: string) {
  if (html.length > MAX_HTML_LENGTH) throw new Error("HTML is too large");
  return parseHTML(html).document;
}
