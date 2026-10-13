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
  /** Compact component documentation (guide.yaml, ADR-0032): when to use it, keywords, tested guarantees. */
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

/** guide.yaml (snake_case, stored in the manifest as `docs`) → the compact form the product uses. */
export function catalogDocs(raw: unknown): CatalogDocs | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    useCases: strings(d.use_cases),
    useWhen: strings(d.use_when),
    // guide.yaml (turbineh.guide/v0.1) writes "why — use <alternative>".
    avoidWhen: strings(d.avoid_when).map((w) => {
      const [why = w, instead = ""] = w.split(/\s+—\s+use\s+/);
      return { instead, why };
    }),
    tradeoffs: Array.isArray(d.tradeoffs)
      ? (d.tradeoffs as unknown[]).map((t) =>
          typeof t === "string"
            ? t
            : `${String((t as { choice?: unknown }).choice ?? "")}: ${String((t as { gain?: unknown }).gain ?? "")} (cost: ${String((t as { cost?: unknown }).cost ?? "")})`,
        )
      : [],
    limits: strings(d.limits),
    keywords: strings(d.keywords),
    guarantees: Array.isArray(d.guarantees) ? d.guarantees.length : 0,
    example: typeof d.example === "string" ? d.example : "",
  };
}
