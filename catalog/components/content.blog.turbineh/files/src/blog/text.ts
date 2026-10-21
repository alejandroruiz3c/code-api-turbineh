/**
 * Pure blog helpers (no database, no environment; unit-tested in tests/unit/blog.test.ts): slugs, XML and JSON-LD
 * escaping, reading time, excerpts, keyword patterns, tags and the Markdown frontmatter the editor accepts.
 */

/** URL slug from a title or a name: lowercase ASCII words joined by "-" (accents folded). */
export const slugify = (title: string, fallback = "post"): string =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || fallback;

/** A slug as it may appear in a URL (anything else is a 404, never a query). */
export const isSlug = (s: string): boolean => /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/.test(s);

/** XML text escaping (RSS, sitemap). */
export const xml = (s: string): string =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c,
  );

/** JSON-LD safe to embed in a <script> tag ("<" escaped so the data can never close the tag). */
export const jsonLd = (data: Record<string, unknown>): string =>
  JSON.stringify(data).replace(/</g, "\\u003c");

/** Markdown reduced to its words (syntax, links' targets and code fences' markers removed). */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const wordCount = (markdown: string): number => {
  const text = plainText(markdown);
  return text ? text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
};

/** Minutes to read at `wordsPerMinute`, rounded up, at least 1. */
export const readingMinutes = (markdown: string, wordsPerMinute: number): number =>
  Math.max(1, Math.ceil(wordCount(markdown) / Math.max(1, wordsPerMinute)));

/** The first `max` characters of the post's text, cut at a word boundary. */
export function excerptOf(markdown: string, max = 200): string {
  const text = plainText(markdown);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).trim()}…`;
}

/** A visitor's search as an ILIKE pattern: wildcards in the input are literal, at most 100 characters. */
export const likePattern = (q: string): string =>
  `%${q
    .trim()
    .slice(0, 100)
    .replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Tags from "a, b, c" or ["a", "b"]: trimmed, de-duplicated by slug, at most 10, each 1–40 characters. */
export function parseTags(input: string | readonly string[]): { name: string; slug: string }[] {
  const list = typeof input === "string" ? input.split(",") : [...input];
  const seen = new Set<string>();
  const out: { name: string; slug: string }[] = [];
  for (const raw of list) {
    const name = raw
      .trim()
      .replace(/^["']|["']$/g, "")
      .slice(0, 40)
      .trim();
    if (!name) continue;
    const slug = slugify(name, "");
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name, slug });
    if (out.length === 10) break;
  }
  return out;
}

export interface Frontmatter {
  title?: string;
  slug?: string;
  excerpt?: string;
  author?: string;
  tags?: string[];
  status?: "draft" | "published";
}

/**
 * Optional frontmatter at the top of a post: a `---` line, `key: value` lines, a closing `---`. Keys: title, slug,
 * excerpt (or description/summary), author, tags (`[a, b]`, `a, b` or a `- item` list), status (draft | published).
 * Unknown keys are reported, never executed or stored. Without frontmatter the source is the body.
 */
export function parseFrontmatter(source: string): {
  data: Frontmatter;
  body: string;
  unknown: string[];
} {
  const text = source.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { data: {}, body: text.trim(), unknown: [] };
  const data: Frontmatter = {};
  const unknown: string[] = [];
  const lines = (m[1] ?? "").split("\n");
  const unquote = (v: string) => v.trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = (kv[1] ?? "").toLowerCase();
    let value = (kv[2] ?? "").trim();
    let items: string[] | null = null;
    if (!value) {
      items = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1] ?? ""))
        items.push(unquote((lines[++i] ?? "").replace(/^\s*-\s+/, "")));
    } else if (/^\[.*\]$/.test(value)) items = value.slice(1, -1).split(",").map(unquote);
    value = unquote(value);
    switch (key) {
      case "title":
      case "slug":
      case "author":
        if (value) data[key] = value;
        break;
      case "excerpt":
      case "description":
      case "summary":
        if (value) data.excerpt = value;
        break;
      case "tags":
      case "tag":
        data.tags = parseTags(items ?? value).map((t) => t.name);
        break;
      case "status":
      case "draft": {
        const v = value.toLowerCase();
        if (key === "draft") data.status = v === "true" ? "draft" : "published";
        else if (v === "draft" || v === "published") data.status = v;
        break;
      }
      default:
        unknown.push(key);
    }
  }
  return { data, body: text.slice(m[0].length).trim(), unknown };
}
