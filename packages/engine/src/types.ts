/** A complete flow TurbineH builds and verifies (a catalog recipe). */
export interface UseCase {
  id: string;
  name: string;
  description: string;
  extends: string | null;
  capabilities: string[];
  requiredComponents: string[];
  sections: string[];
  keywords: string[];
}

/** An approved catalog component as the engine sees it (from the catalog table or the manifests). */
export interface CatalogEntry {
  id: string;
  version: string;
  category: string;
  provides: string[];
  license: string;
  purl: string;
  does: string;
  useCases?: string[];
  /** Compact component documentation (docs.yaml, ADR-0032): when to use it, keywords, tested guarantees. */
  docs?: CatalogDocs | null;
}

export interface CatalogDocs {
  useCases: string[];
  useWhen: string[];
  avoidWhen: { instead: string; why: string }[];
  tradeoffs: string[];
  limits: string[];
  keywords: string[];
  guarantees: number;
  example: string;
}

/** docs.yaml (snake_case, stored in the manifest as `docs`) → the compact form the product uses. */
export function catalogDocs(raw: unknown): CatalogDocs | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    useCases: strings(d.use_cases),
    useWhen: strings(d.when_to_use),
    avoidWhen: Array.isArray(d.when_not_to_use)
      ? (d.when_not_to_use as { instead?: unknown; why?: unknown }[])
          .filter((w) => typeof w.instead === "string" && typeof w.why === "string")
          .map((w) => ({ instead: w.instead as string, why: w.why as string }))
      : [],
    tradeoffs: strings(d.tradeoffs),
    limits: strings(d.limits),
    keywords: strings(d.keywords),
    guarantees: Array.isArray(d.guarantees) ? d.guarantees.length : 0,
    example: typeof d.example === "string" ? d.example : "",
  };
}
