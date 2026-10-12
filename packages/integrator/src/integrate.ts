import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sandbox } from "@turbineh/verifier";
import { askFile, withHeader, type ModelCfg, type Usage } from "./model.js";

/** An approved catalog component that is not part of the recipe yet (strategy: dependency). */
export interface ExternalComponent {
  id: string;
  capability: string;
  /** Plain-language label of the capability. */
  label: string;
  pkg: { name: string; version: string };
  does: string;
  doesNot: string;
  /** Exact `@types/x@version` for libraries without bundled types (from the manifest). */
  typesPkg?: string;
  /** Directory of the component in the catalog (holds component.yaml and contract.test.ts). */
  dir: string;
}

export interface IntegrationResult {
  component: string;
  capability: string;
  glue: string | null;
  contractTest: string | null;
  usage: Usage;
  error?: string;
}

/** UI capabilities may render React, so their glue is a .tsx module; everything else is plain .ts. */
export const glueFile = (capability: string) =>
  `src/integrations/${capability.replace(/\./g, "-")}.${capability.startsWith("ui.") ? "tsx" : "ts"}`;

/**
 * Deterministic part: exact versions into package.json and a lockfile refresh inside the sandbox (package registry
 * only, no secrets). Versions come from the approved manifests, never from a model.
 */
export async function installComponents(dir: string, comps: ExternalComponent[]): Promise<void> {
  if (comps.length === 0) return;
  const path = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  for (const c of comps) {
    pkg.dependencies[c.pkg.name] = c.pkg.version;
    const t = c.typesPkg ? /^(@types\/[^@]+)@(.+)$/.exec(c.typesPkg) : null;
    if (t?.[1] && t[2]) pkg.devDependencies[t[1]] = t[2];
  }
  pkg.devDependencies = Object.fromEntries(
    Object.entries(pkg.devDependencies).sort(([a], [b]) => a.localeCompare(b)),
  );
  pkg.dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  const r = await sandbox(dir, "pnpm install --lockfile-only", { network: "bridge", env: {} });
  if (r.code !== 0) throw new Error(`lockfile refresh failed: ${r.tail.slice(-400)}`);
}

/** The component's own contract test runs inside the app's verification: real evidence the library works here. */
export function copyContractTest(dir: string, c: ExternalComponent): string | null {
  const src = join(c.dir, "contract.test.ts");
  if (!existsSync(src)) return null;
  const rel = `tests/unit/components/${c.id}.test.ts`;
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  copyFileSync(src, join(dir, rel));
  return rel;
}

/** `glue.ts` next to the manifest: written by TurbineH, type-checked at certification, used as-is. */
export function copyCuratedGlue(dir: string, c: ExternalComponent): string | null {
  const src = join(c.dir, "glue.ts");
  if (!existsSync(src)) return null;
  const file = glueFile(c.capability);
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(
    join(dir, file),
    withHeader(
      `// turbineh:generated glue component=${c.id} source=catalog`,
      readFileSync(src, "utf8"),
    ),
  );
  return file;
}

const GLUE_SYSTEM = `You write ONE small TypeScript module that lets a Next.js app use one npm library.
Export 1 to 3 small, typed helper functions with JSDoc. Import only from the given package (and "zod" if you validate
input). No side effects at import time, no network calls, no environment variables, no secrets, no default export.
Follow the usage shown in the contract test exactly (it passed against this exact version).
If the file name ends in .tsx and you export a React component, start the file with "use client";.`;

/** Small generated glue (compiler model): one call per component, minimal context. */
export async function writeGlue(
  dir: string,
  c: ExternalComponent,
  cfg: ModelCfg,
): Promise<{ file: string; usage: Usage }> {
  const contract = existsSync(join(c.dir, "contract.test.ts"))
    ? readFileSync(join(c.dir, "contract.test.ts"), "utf8")
    : "";
  const { content, usage } = await askFile(
    cfg,
    GLUE_SYSTEM,
    {
      file: glueFile(c.capability),
      package: `${c.pkg.name}@${c.pkg.version}`,
      purpose: c.label,
      does: c.does,
      does_not: c.doesNot,
      contract_test: contract,
    },
    2500,
  );
  const file = glueFile(c.capability);
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(
    join(dir, file),
    withHeader(`// turbineh:generated glue component=${c.id} model=${cfg.model}`, content),
  );
  return { file, usage };
}

/** Installs every component once, then writes contract tests and glue in parallel. */
export async function integrateComponents(
  dir: string,
  comps: ExternalComponent[],
  cfg: ModelCfg,
): Promise<IntegrationResult[]> {
  await installComponents(dir, comps);
  return Promise.all(
    comps.map(async (c): Promise<IntegrationResult> => {
      const contractTest = copyContractTest(dir, c);
      // UI components are used directly in screens (their contract test shows how); wrapping their prop types is
      // where small models fail most, so no glue is generated for them.
      if (c.capability.startsWith("ui.")) {
        return {
          component: c.id,
          capability: c.capability,
          glue: null,
          contractTest,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      }
      // Curated glue shipped with the component (reviewed, certified with it): copied, no model call.
      const curated = copyCuratedGlue(dir, c);
      if (curated) {
        return {
          component: c.id,
          capability: c.capability,
          glue: curated,
          contractTest,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      }
      try {
        const g = await writeGlue(dir, c, cfg);
        return {
          component: c.id,
          capability: c.capability,
          glue: g.file,
          contractTest,
          usage: g.usage,
        };
      } catch (err) {
        // The library and its contract test stay; only the optional glue is missing.
        return {
          component: c.id,
          capability: c.capability,
          glue: null,
          contractTest,
          usage: { input_tokens: 0, output_tokens: 0 },
          error: err instanceof Error ? err.message.slice(0, 200) : "glue failed",
        };
      }
    }),
  );
}
