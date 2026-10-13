/**
 * Pure rules of the public pages (component site.public-pages.turbineh), unit-tested in tests/unit/site-pages.test.ts:
 * URL slugs, list filters and safe image URLs.
 */

/** "Puente de Ría — Bilbao" → "puente-de-ria-bilbao". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** Whether an entry's attributes match every chosen filter (case-insensitive equality). */
export function matchesFilters(
  attributes: Record<string, string>,
  filters: Record<string, string>,
): boolean {
  return Object.entries(filters).every(
    ([k, v]) => (attributes[k] ?? "").toLowerCase() === v.toLowerCase(),
  );
}

/** An http(s) image URL, or null (no javascript:, data: or relative tricks on public pages). */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
