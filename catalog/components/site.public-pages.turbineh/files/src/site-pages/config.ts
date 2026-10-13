import { z } from "zod";
import params from "./params.json";

/**
 * Public pages of the site (component site.public-pages.turbineh), written by TurbineH from the request ("projects
 * portfolio with filters by sector and a page per project, careers with open positions"): one collection per entity
 * with its path, whether each record has its own page, and the fields visitors filter by. Validated at start-up.
 */
const Page = z.object({
  entity: z.string().regex(/^[A-Z][A-Za-z0-9]{0,59}$/),
  path: z.string().regex(/^\/[a-z0-9][a-z0-9-]{0,59}$/),
  detail: z.boolean(),
  filters: z.array(z.string().max(80)).max(10),
  title: z.string().max(80).optional(),
});

export const SitePagesParams = z.object({ pages: z.array(Page).min(1).max(12), seo: z.boolean() });

/** "JobPosition" → ["Job", "Position"]. */
const words = (entity: string) => entity.match(/[A-Z][a-z0-9]*|[0-9]+/g) ?? [entity];
const plural = (w: string) =>
  /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : /(s|x|ch|sh)$/i.test(w) ? `${w}es` : `${w}s`;

export interface Collection {
  key: string;
  entity: string;
  path: string;
  detail: boolean;
  /** Filter fields: lowercase keys of at most two words (longer phrases from a request are not fields). */
  filters: { key: string; label: string }[];
  label: string;
  plural: string;
}

export function toCollections(p: z.infer<typeof SitePagesParams>): Collection[] {
  const seen = new Set<string>();
  return p.pages
    .map((page) => {
      const w = words(page.entity);
      const label = w.join(" ");
      const filters = [
        ...new Set(
          page.filters
            .map((f) => f.trim().toLowerCase())
            .filter((f) => /^[a-z][a-z0-9]*( [a-z0-9]+)?$/.test(f)),
        ),
      ].map((f) => ({ key: f.replace(/ /g, "_"), label: f.charAt(0).toUpperCase() + f.slice(1) }));
      return {
        key: page.path.slice(1),
        entity: page.entity,
        path: page.path,
        detail: page.detail,
        filters,
        label,
        plural: page.title ?? [...w.slice(0, -1), plural(w.at(-1) ?? "")].join(" "),
      };
    })
    .filter((c) => !seen.has(c.key) && (seen.add(c.key), true));
}

export const sitePagesConfig = SitePagesParams.parse(params);
export const collections: Collection[] = toCollections(sitePagesConfig);
export const collectionOf = (key: string) => collections.find((c) => c.key === key) ?? null;
