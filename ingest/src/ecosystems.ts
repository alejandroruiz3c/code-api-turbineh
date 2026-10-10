import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Subset of the ecosyste.ms package record we keep. */
export interface EcosystemsPackage {
  name: string;
  description: string | null;
  keywords_array: string[] | null;
  normalized_licenses: string[] | null;
  licenses: string | null;
  repository_url: string | null;
  homepage: string | null;
  downloads: number | null;
  dependent_packages_count: number | null;
  latest_release_number: string | null;
  latest_release_published_at: string | null;
  advisories: unknown[] | null;
  purl: string | null;
  status: string | null;
}

const BASE = "https://packages.ecosyste.ms/api/v1/registries/npmjs.org";

export interface FetchOptions {
  cacheDir: string;
  /** Contact for the API operator, sent as User-Agent (polite crawling). */
  userAgent: string;
}

/**
 * One page of npm packages. Cached on disk so re-runs never hit the API twice;
 * honours rate-limit headers with exponential backoff.
 */
export async function fetchPage(
  query: { sort: "downloads" | "dependent_packages_count"; page: number; perPage?: number },
  opts: FetchOptions,
): Promise<EcosystemsPackage[]> {
  mkdirSync(opts.cacheDir, { recursive: true });
  const perPage = query.perPage ?? 100;
  const file = join(opts.cacheDir, `npm-${query.sort}-${perPage}-${query.page}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as EcosystemsPackage[];

  const url = `${BASE}/packages?sort=${query.sort}&order=desc&per_page=${perPage}&page=${query.page}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": opts.userAgent, Accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as EcosystemsPackage[];
      writeFileSync(file, JSON.stringify(data));
      return data;
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 0);
      await new Promise((r) => setTimeout(r, Math.max(retryAfter * 1000, 1000 * 2 ** attempt)));
      continue;
    }
    throw new Error(`ecosyste.ms ${res.status} for ${url}`);
  }
  throw new Error(`ecosyste.ms: giving up on ${url}`);
}

/** Text used for retrieval: name, description and keywords. */
export function packageCard(p: EcosystemsPackage): string {
  const kw = (p.keywords_array ?? []).slice(0, 15).join(", ");
  return [p.name, p.description ?? "", kw ? `keywords: ${kw}` : ""]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 1000);
}
