/** Offset pagination for server-rendered lists (component data.pagination.turbineh). */
export const PAGE_SIZE = 20;

export function parsePage(value: string | string[] | undefined): {
  page: number;
  offset: number;
  limit: number;
} {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(raw ?? "1", 10);
  const page = Number.isFinite(n) && n > 0 && n < 10_000 ? n : 1;
  return { page, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE };
}

/** Free-text search term from the query string, trimmed and bounded. */
export function parseQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim().slice(0, 100);
}
