import type { CapabilitySummary } from "@turbineh/shared";
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
  /** What the area is, in one line: the catalogue text up to its list of functions (ADR-0076). */
  tagline: string;
  /**
   * Verified functions of the area (ADR-0076): readable labels of its canonical criteria and those of the components it
   * always installs, each linked to the test that proves it (ADR-0063).
   */
  functions: string[];
  /** Approved functional components that extend this area (`capability.use_cases`), with their proved functions. */
  addOns: UseCaseAddOn[];
}

/** A verified component that extends a use case (ADR-0076). */
export interface UseCaseAddOn {
  /** Catalogue id. */
  id: string;
  /** Short display name (guide.yaml `name`). */
  name: string;
  /** One line (guide.yaml `tagline`). */
  tagline: string;
  /** Its functions proved by tests (criteria.yaml labels). */
  functions: string[];
}

/** Catalogue totals computed from the catalogue (ADR-0076), never written by hand. */
export interface CatalogTotals {
  /** Approved components. */
  components: number;
  /** Complete use cases (recipes). */
  useCases: number;
  /** Functions proved by tests: canonical criteria of recipes and approved components with their own linked tests. */
  functions: number;
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
  /** Source and compile record of the example (guide.yaml `example_check`, ADR-0066). */
  exampleCheck?: CapabilityExampleCheck;
}

export type CapabilityExampleCheck = NonNullable<CapabilitySummary["exampleCheck"]>;

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
    ...withExampleCheck(exampleCheckOf(d.example_check)),
  };
}

function withExampleCheck(c: CapabilityExampleCheck | undefined): {
  exampleCheck?: CapabilityExampleCheck;
} {
  return c ? { exampleCheck: c } : {};
}

function exampleCheckOf(raw: unknown): CapabilityExampleCheck | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  const kinds = ["typescript", "app", "json", "shell"] as const;
  const kind = kinds.find((k) => k === c.kind);
  if (!kind || typeof c.from !== "string") return undefined;
  const compiled = c.compiled as Record<string, unknown> | undefined;
  return {
    kind,
    from: c.from,
    ...(compiled &&
    Array.isArray(compiled.against) &&
    typeof compiled.typescript === "string" &&
    typeof compiled.on === "string"
      ? {
          compiled: {
            against: compiled.against.filter((x): x is string => typeof x === "string"),
            typescript: compiled.typescript,
            on: compiled.on,
          },
        }
      : {}),
  };
}

/**
 * TurbineH platform services documented in the catalog so people, agents and the decider can find them (search,
 * inspect), but which are API features rather than code vendored into an app: never selected into a package.
 */
export const PLATFORM_SERVICES: ReadonlySet<string> = new Set([
  "deploy.github-pull-request.turbineh",
  "ops.repo-analysis.turbineh",
]);
