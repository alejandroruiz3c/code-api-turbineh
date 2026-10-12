import * as cheerio from "cheerio";

const MAX_HTML_LENGTH = 2_000_000;

/** Texts matching a CSS selector (trimmed, empty ones dropped). */
export function selectTexts(html: string, selector: string): string[] {
  if (html.length > MAX_HTML_LENGTH) throw new Error("HTML is too large");
  const $ = cheerio.load(html);
  return $(selector)
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
}

/** Absolute http(s) links of a page (other schemes such as javascript: are dropped). */
export function selectLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $("a[href]").each((_, el) => {
    try {
      const u = new URL($(el).attr("href") ?? "", baseUrl);
      if (u.protocol === "https:" || u.protocol === "http:") out.add(u.toString());
    } catch {
      /* invalid URL */
    }
  });
  return [...out];
}
