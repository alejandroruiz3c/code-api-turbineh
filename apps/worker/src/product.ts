import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPlan,
  catalogToPlanned,
  PLATFORM_SERVICES,
  decisionFromSelection,
  searchCapabilities,
  USE_CASES,
  writeComponentPackage,
  writeFlowPackage,
  zipDirectory,
  type CatalogEntry,
  type PackageInfo,
  type PlannedComponent,
  type RepoAnalysis,
} from "@turbineh/engine";
import type { CheckResult, DetectedStack, Plan, ProjectPreferences } from "@turbineh/shared";
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
}

interface Manifest {
  id: string;
  version?: string;
  status: string;
  category: string;
  source: { purl: string };
  capability: { does: string; use_cases?: string[] };
  license: { declared: string };
  relations: { provides: string[] };
}

/** Approved catalog components as engine entries (from git manifests, the source of truth). */
export function catalogEntries(componentsDir: string): (CatalogEntry & { dir: string })[] {
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

/** Plan of a complete flow, from the real selection and resolution of the pipeline. */
export function flowPlan(input: {
  buildId: string;
  request: PlanRequest;
  slug: string;
  recipeId: string;
  selected: Record<
    string,
    { id: string; pkg: { name: string; version: string }; license: { declared: string } }
  >;
  decisions: {
    capability: string;
    best: { id: string; p: number } | null;
    ranked: { id: string }[];
  }[];
  gaps: string[];
  templateDeps: Record<string, string>;
  templateEnv: string;
  componentsDir: string;
  entities: string[];
  labels: (cap: string) => string;
  /** No template matched the need exactly: it is built on the closest one (ADR-0050). */
  scope?: { builtOn: string; reason: string };
}): Plan {
  const useCase = USE_CASES.find((u) => u.id === input.recipeId) ?? null;
  const components: PlannedComponent[] = Object.entries(input.selected).map(([capability, c]) => ({
    id: c.id,
    version: c.pkg.version,
    license: c.license.declared,
    purl: purlOf(c.pkg),
    capability,
    why:
      input.decisions.find((d) => d.capability === capability)?.best?.id === c.id
        ? `Best verified fit for ${input.labels(capability)}`
        : `Required by the ${useCase?.name ?? input.recipeId} flow for ${input.labels(capability)}`,
  }));
  let env = input.templateEnv;
  for (const c of components) {
    const append = join(input.componentsDir, c.id, "files", ".env.example.append");
    if (existsSync(append)) env += `\n${readFileSync(append, "utf8")}`;
  }
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
    gaps: input.gaps,
    decisions: input.decisions
      .map((d) => decisionFromSelection({ ...d, label: input.labels(d.capability) }))
      .filter((d): d is NonNullable<typeof d> => d !== null),
    dependencies: deps,
    ...(input.request.projectDependencies
      ? { projectDependencies: input.request.projectDependencies }
      : {}),
    notCovered: [
      ...(input.scope
        ? [
            `What is specific to your need beyond a ${useCase?.name ?? input.recipeId} app: no ready-made template matched it exactly, so it is built on the closest one`,
          ]
        : []),
      ...(INFERENCE.test(input.request.need) &&
      !components.some((c) => c.id.startsWith("ai.orchestrator"))
        ? [
            `The AI part of the need: this app has no AI built in. Add it afterwards with a new flow such as "AI assistant for <task>" (TurbineH orchestration with its AI Safety Pack)`,
          ]
        : []),
    ],
    labels: input.labels,
    envKeys: envKeysOf(env),
    entities: input.entities,
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

const INFERENCE =
  /\b(ai|llm|gpt|model|inference|classif|summar|extract|chat|agent|assistant|embedding|rag|translat|generat)/i;

/**
 * Component-only plan (no complete use case fits): the certified components that cover the need. Any need that
 * involves inference gets the TurbineH AI orchestrator and its AI Safety Pack (PLAN §16, owner decision).
 */
export function componentPlan(buildId: string, request: PlanRequest, componentsDir: string): Plan {
  // Platform services (repository integration, analysis) are discoverable in search but never packaged as code.
  const all = catalogEntries(componentsDir).filter((c) => !PLATFORM_SERVICES.has(c.id));
  const found = searchCapabilities(request.need, all, { limit: 30, useCases: [] }).filter(
    (x) => x.kind === "component",
  );
  const picked = new Map<string, CatalogEntry>();
  const byId = (id: string) => all.find((c) => c.id === id);
  if (INFERENCE.test(request.need)) {
    for (const id of ["ai.orchestrator.turbineh", "security.ai-safety.turbineh"]) {
      const c = byId(id);
      if (c) picked.set(id, c);
    }
  }
  const seenCaps = new Set([...picked.values()].flatMap((c) => c.provides));
  for (const f of found) {
    const c = byId(f.id);
    if (!c || c.provides.every((p) => seenCaps.has(p))) continue;
    picked.set(c.id, c);
    c.provides.forEach((p) => seenCaps.add(p));
    if (picked.size >= 6) break;
  }
  const components = [...picked.values()].map((c) =>
    catalogToPlanned(
      c,
      c.provides[0] ?? c.category,
      c.id.startsWith("ai.orchestrator")
        ? "Every inference goes through TurbineH orchestration (understand intent → orchestrate decisions → execute)"
        : c.id.startsWith("security.ai-safety")
          ? "Always shipped with the orchestrator: input guardrails, budgets, output checks, audit"
          : `Covers "${c.provides.join(", ")}" — certified, audited component`,
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
