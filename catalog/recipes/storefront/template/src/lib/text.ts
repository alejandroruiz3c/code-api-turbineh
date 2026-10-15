/** Pure text helpers (no environment access, unit-tested). */

/** JSON-LD safe to embed in a <script> tag ("<" escaped so the data can never close the tag). */
export const jsonLd = (data: Record<string, unknown>) =>
  JSON.stringify(data).replace(/</g, "\\u003c");

/** XML text escaping for RSS. */
export const xml = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c,
  );

/** URL slug from a title. */
export const slugify = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "post";
