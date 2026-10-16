// A server-rendered list page in the app (e.g. src/app/dashboard/projects/page.tsx).
import { PAGE_SIZE, parsePage, parseQuery } from "@/lib/pagination";

export function listParams(searchParams: { page?: string | string[]; q?: string | string[] }) {
  const { page, offset, limit } = parsePage(searchParams.page); // invalid or missing → page 1
  const q = parseQuery(searchParams.q); // trimmed, at most 100 characters
  return { page, offset, limit, q, pageSize: PAGE_SIZE };
}

export const second = listParams({ page: "2", q: "  search term  " }); // offset = PAGE_SIZE, q = "search term"
