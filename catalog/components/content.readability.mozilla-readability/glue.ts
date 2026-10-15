import { Readability } from "@mozilla/readability";

/** A DOM document, e.g. from content.html-dom (linkedom) on the server. */
export type HtmlDocument = ConstructorParameters<typeof Readability>[0];

/**
 * Main article of a page (title + text), without navigation, ads or footers. Returns null when the page has no
 * readable article. Readability mutates the document: pass a fresh one.
 */
export function readArticle(doc: HtmlDocument): { title: string; text: string } | null {
  const article = new Readability(doc, { charThreshold: 200 }).parse();
  if (!article?.textContent) return null;
  return { title: article.title ?? "", text: article.textContent.replace(/\s+\n/g, "\n").trim() };
}
