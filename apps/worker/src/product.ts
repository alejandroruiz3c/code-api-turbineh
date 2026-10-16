import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPlan,
  catalogToPlanned,
  PLATFORM_SERVICES,
  componentsForNeed,
  USE_CASES,
  writeComponentPackage,
  writeFlowPackage,
  zipDirectory,
  type CatalogEntry,
  type PackageInfo,
  type PlannedComponent,
  type RepoAnalysis,
} from "@turbineh/engine";
import {
  promiseOf,
  whyOf,
  type CheckResult,
  type Decision,
  type DeliveryManifest,
  type DetectedStack,
  type Plan,
  type ProjectPreferences,
} from "@turbineh/shared";
import type { ArtifactStorage } from "@turbineh/storage";
import { parse } from "yaml";

/** Planning context sent by the API (PLAN §16.4): the need, the detected stack and the project's preferences. */
export interface PlanRequest {
  need: string;
  stack: DetectedStack;
  /** The project's declared dependencies (from its package.json), so only new ones are planned. */
  projectDependencies?: Record<string, string>;
  preferences?: ProjectPreferences;
  /** Analysis of the connected repository (PLAN §16 P5). */
  analysis?: RepoAnalysis;
  /** Verified components the person chose explicitly (ADR-0052): exactly these are planned. */
  components?: string[];
}

interface Manifest {
  id: string;
  version?: string;
  status: string;
  category: string;
  source: { purl: string };
  capability: { does: string; use_cases?: string[] };
  license: { declared: string };
  relations: { provides: string[]; requires?: string[] };
  effects?: { db?: boolean };
}

/** Approved catalog components as engine entries (from git manifests, the source of truth). */
export function catalogEntries(
  componentsDir: string,
): (CatalogEntry & { dir: string; requires: string[]; usesDatabase: boolean })[] {
  return readdirSync(componentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(componentsDir, d.name, "component.yaml")))
    .map((d) => ({
      dir: join(componentsDir, d.name),
      m: parse(readFileSync(join(componentsDir, d.name, "component.yaml"), "utf8")) as Manifest,
    }))
    .filter(({ m }) => m.status === "approved")
    .map(({ dir, m }) => ({
      dir,
      id: m.id,
      version: /@([^@]+)$/.exec(m.source.purl)?.[1] ?? m.version ?? "1.0.0",
      category: m.category,
      provides: m.relations.provides,
      license: m.license.declared,
      purl: m.source.purl,
      does: m.capability.does,
      useCases: m.capability.use_cases ?? [],
      requires: m.relations.requires ?? [],
      usesDatabase: m.effects?.db === true,
    }));
}

const purlOf = (pkg: { name: string; version: string }) =>
  pkg.name.startsWith("turbineh/")
    ? `pkg:generic/${pkg.name}@${pkg.version}`
    : `pkg:npm/${pkg.name}@${pkg.version}`;

const envKeysOf = (text: string) =>
  text
    .split("\n")
    .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l.trim())?.[1])
    .filter((k): k is string => Boolean(k));

/**
 * Plan of a complete flow, rendered from the delivery manifest (ADR-0064) of the pipeline's real selection and
 * resolution: one decision per component the package will contain (including the ones the use case's code needs) and
 * per capability TurbineH writes or does not include, each with what in the request justifies it; the settings of
 * the app's env schema; nothing decided that the package will not use.
 */
export function flowPlan(input: {
  buildId: string;
  request: PlanRequest;
  slug: string;
  recipeId: string;
  selected: Record<
    string,
    { id: string; pkg: { name: string; version: string }; license: { declared: string } }
  >;
  /** The selection's ranking per capability (alternatives and confidence of the components it chose). */
  decisions: {
    capability: string;
    best: { id: string; p: number } | null;
    ranked: { id: string }[];
  }[];
  templateDeps: Record<string, string>;
  entities: string[];
  labels: (cap: string) => string;
  delivery: DeliveryManifest;
  /** No template matched the need exactly: it is built on the closest one (ADR-0050). */
  scope?: { builtOn: string; reason: string };
}): Plan {
  const useCase = USE_CASES.find((u) => u.id === input.recipeId) ?? null;
  const entries = input.delivery.entries;
  const components: PlannedComponent[] = entries.flatMap((e) => {
    const c = e.way === "component" ? input.selected[e.capability] : undefined;
    if (!c) return [];
    return [
      {
        id: c.id,
        version: c.pkg.version,
        license: c.license.declared,
        purl: purlOf(c.pkg),
        capability: e.capability,
        why: whyOf(e),
      },
    ];
  });
  const decisions: Decision[] = entries
    .filter((e) => e.way !== "recipe")
    .map((e) => {
      const ranked = input.decisions.find((d) => d.capability === e.capability);
      const chosen = ranked?.best && ranked.best.id === e.component ? ranked.best.p : null;
      return {
        topic: e.capability,
        choice:
          e.way === "component"
            ? (e.component ?? e.capability)
            : e.way === "written"
              ? "written by TurbineH"
              : "not included",
        why:
          e.way === "not_included"
            ? `Not included: ${e.reason ?? "no verified component can be used"}. ${whyOf(e)}`
            : `${promiseOf(e).replace(/^./, (c) => c.toUpperCase())}. ${whyOf(e)}`,
        alternatives: (ranked?.ranked ?? [])
          .map((r) => r.id)
          .filter((id) => id !== e.component)
          .slice(0, 3),
        // Components chosen by code (required by the use case or by another component) are certain.
        confidence: chosen !== null ? Math.round(chosen * 100) / 100 : 1,
        way: e.way,
        justifiedBy: e.justifiedBy,
      };
    });
  const deps = Object.entries(input.templateDeps).map(([name, version]) => ({ name, version }));
  for (const c of components) {
    const npm = /^pkg:npm\/(.+)@([^@]+)$/.exec(c.purl);
    if (npm?.[1] && npm[2] && !deps.some((d) => d.name === npm[1]))
      deps.push({ name: npm[1], version: npm[2] });
  }
  return buildPlan({
    id: input.buildId,
    need: input.request.need,
    slug: input.slug,
    stack: input.request.stack,
    useCase,
    components,
    gaps: entries.filter((e) => e.way === "written").map((e) => e.capability),
    decisions,
    dependencies: deps,
    ...(input.request.projectDependencies
      ? { projectDependencies: input.request.projectDependencies }
      : {}),
    // ADR-0052: what the library does not cover never reaches a plan as "left" work — the scope gate refuses it or
    // removes it from scope with the person's explicit choice (`Plan.scope`).
    notCovered: [],
    labels: input.labels,
    entities: input.entities,
    delivery: input.delivery,
    ...(input.request.preferences ? { preferences: input.request.preferences } : {}),
    ...(input.request.analysis ? { analysis: input.request.analysis } : {}),
  });
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 5)
    .join("-") || "capability";

/**
 * A need that involves inference (gets the AI orchestrator and its AI Safety Pack). Word starts that also mean plain
 * code were removed (ADR-0051): "generate QR codes", "data model" or "extract text from a PDF" are not inference.
 */
const INFERENCE =
  /\b(ai|llm|gpt|language model|inference|classif|summar|chat|agent|assistant|embedding|rag|translat|generative|prompt)/i;

/**
 * Component-only plan (no complete use case fits): the certified components that cover the need. Any need that
 * involves inference gets the TurbineH AI orchestrator and its AI Safety Pack (PLAN §16, owner decision).
 */
export function componentPlan(
  buildId: string,
  request: PlanRequest,
  componentsDir: string,
  /** Components the person chose (ADR-0052): exactly these (plus what they require), nothing inferred. */
  explicit: readonly string[] = [],
  /** Why each component is in the plan, when the caller knows better (a components-only offer, ADR-0062). */
  why: Readonly<Record<string, string>> = {},
): Plan {
  // Platform services (repository integration, analysis) are discoverable in search but never packaged as code.
  const all = catalogEntries(componentsDir).filter((c) => !PLATFORM_SERVICES.has(c.id));
  const picked = new Map<string, CatalogEntry>();
  const byId = (id: string) => all.find((c) => c.id === id);
  const chosen = new Set<string>();
  for (const id of explicit) {
    const c = byId(id);
    if (c) {
      picked.set(id, c);
      chosen.add(id);
    }
  }
  if (chosen.size === 0 && INFERENCE.test(request.need)) {
    for (const id of ["ai.orchestrator.turbineh", "security.ai-safety.turbineh"]) {
      const c = byId(id);
      if (c) picked.set(id, c);
    }
  }
  // Only what the need asks for (ADR-0051): rare words decide, a further component only for a further capability of
  // the need. Before, any component sharing one word ("small", "client", "external") was added, up to six.
  const matched = new Map<string, string[]>();
  for (const m of chosen.size ? [] : componentsForNeed(request.need, all, { limit: 6 })) {
    if (m.entry.provides.every((p) => [...picked.values()].some((c) => c.provides.includes(p))))
      continue;
    picked.set(m.entry.id, m.entry);
    matched.set(m.entry.id, m.covers);
  }
  // Declared dependencies of what was chosen (relations.requires), e.g. the orchestrator's AI Safety Pack.
  for (const c of [...picked.values()]) {
    for (const id of byId(c.id)?.requires ?? []) {
      const dep = byId(id);
      if (dep && !picked.has(id)) picked.set(id, dep);
    }
  }
  const components = [...picked.values()].map((c) =>
    catalogToPlanned(
      c,
      c.provides[0] ?? c.category,
      why[c.id] ??
        (chosen.has(c.id)
          ? `Chosen by you — certified, audited component (${c.does})`
          : c.id.startsWith("ai.orchestrator")
            ? "Every inference goes through TurbineH orchestration (understand intent → orchestrate decisions → execute)"
            : c.id.startsWith("security.ai-safety")
              ? "Always shipped with the orchestrator: input guardrails, budgets, output checks, audit"
              : matched.has(c.id)
                ? `Covers "${c.provides.join(", ")}" — what your need asks for (${(matched.get(c.id) ?? []).join(", ")}); certified, audited component`
                : `Required by ${[...picked.values()].find((p) => byId(p.id)?.requires.includes(c.id))?.id ?? "a selected component"} — certified, audited component`),
    ),
  );
  const deps = components
    .map((c) => /^pkg:npm\/(.+)@([^@]+)$/.exec(c.purl))
    .filter((m): m is RegExpExecArray => Boolean(m?.[1] && m[2]))
    .map((m) => ({ name: m[1] ?? "", version: m[2] ?? "" }));
  const env = components
    .map((c) => join(componentsDir, c.id, "files", ".env.example.append"))
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  return buildPlan({
    id: buildId,
    need: request.need,
    slug: slugify(request.need),
    stack: request.stack,
    useCase: null,
    components,
    gaps: [],
    decisions: components.map((c) => ({
      topic: c.capability,
      choice: c.id,
      why: c.why,
      alternatives: [],
      confidence: 1,
    })),
    dependencies: deps,
    ...(request.projectDependencies ? { projectDependencies: request.projectDependencies } : {}),
    envKeys: envKeysOf(env),
    usesDatabase: [...picked.values()].some((c) => byId(c.id)?.usesDatabase),
    ...(request.preferences ? { preferences: request.preferences } : {}),
    ...(request.analysis ? { analysis: request.analysis } : {}),
  });
}

/** Writes the capability package (PLAN §16.3), zips it and stores it next to the build's artefacts. */
export async function storeCapabilityPackage(
  buildId: string,
  storage: ArtifactStorage,
  info: Omit<PackageInfo, "checks"> & { checks: CheckResult[] },
  source: { appDir: string } | { components: (CatalogEntry & { dir: string })[] },
): Promise<{ slug: string; zipKey: string; manifestKey: string; sizeBytes: number }> {
  const root = mkdtempSync(join(tmpdir(), "turbineh-pkg-"));
  try {
    const dir =
      "appDir" in source
        ? writeFlowPackage(source.appDir, root, info)
        : writeComponentPackage(
            source.components.map((c) => ({
              id: c.id,
              version: c.version,
              license: c.license,
              purl: c.purl,
              capability: c.provides[0] ?? c.category,
              dir: c.dir,
              does: c.does,
            })),
            root,
            info,
          );
    const zip = zipDirectory(dir, info.slug);
    const zipKey = `builds/${buildId}/package/${info.slug}.zip`;
    const manifestKey = `builds/${buildId}/package/manifest.json`;
    await storage.put(zipKey, zip, "application/zip");
    await storage.put(manifestKey, readFileSync(join(dir, "manifest.json")), "application/json");
    return { slug: info.slug, zipKey, manifestKey, sizeBytes: zip.length };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
