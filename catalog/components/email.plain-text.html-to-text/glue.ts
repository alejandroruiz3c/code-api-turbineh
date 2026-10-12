import { convert } from "html-to-text";

/** Larger inputs are not emails: refuse them instead of spending CPU on the server. */
const MAX_HTML_LENGTH = 500_000;

/**
 * Plain-text alternative of an HTML email (sent next to the HTML part, better deliverability): headings and
 * paragraphs kept, links as "text [url]" (the URL only once when the text already is the URL), images skipped,
 * lines wrapped at 78 characters as recommended for email.
 */
export function htmlToPlainText(html: string): string {
  if (html.length > MAX_HTML_LENGTH) throw new Error("Email HTML is too large");
  return convert(html, {
    wordwrap: 78,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
    ],
  }).trim();
}
