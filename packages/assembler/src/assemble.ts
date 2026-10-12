import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import type { BuildSpec } from "@turbineh/compiler";
import type { Candidate } from "@turbineh/resolver";
import {
  entitiesToGenerate,
  generateEntity,
  generateIndexes,
  type GeneratedFile,
} from "./entities.js";
import { entityNames } from "./naming.js";
import { applyBrand, type Brand } from "./brand-theme.js";
import { writeSiteContent } from "./site-content.js";
import { deployGuide, startHereHtml, type HandoverFacts } from "./handover.js";
import { materializeRecipe, mergedRecipe } from "./recipes.js";

export interface SelectedComponent {
  capability: string;
  component: Candidate;
  /** Decider evidence for COMPONENTS.md. */
  why: { pBest: number; covers: number; risk: number };
}

export interface AssembleInput {
  buildId: string;
  /** catalog/recipes — the recipe chain for spec.recipe is materialized from here. */
  recipesDir: string;
  /** Recipe to build (may differ from spec.recipe when a family falls back to its closest recipe). */
  recipe: string;
  outDir: string;
  spec: BuildSpec;
  selected: SelectedComponent[];
  /** Capabilities left uncovered (recorded honestly; Backup Coder in later phases). */
  gaps: { capability: string; trigger: string }[];
  /** Client brand (validated); applied as theme tokens and logo. */
  brand?: Brand | null;
}

export interface AssembleResult {
  files: { path: string; generated: boolean; lines: number }[];
  generatedLines: number;
  reusedLines: number;
}

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".mjs",
  ".js",
  ".json",
  ".md",
  ".css",
  ".yml",
  ".yaml",
  ".example",
  "",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Copies the recipe, fills placeholders, writes generated entity code and documentation. */
export function assemble(input: AssembleInput): AssembleResult {
  const { spec, outDir } = input;
  mkdirSync(outDir, { recursive: true });
  const recipe = mergedRecipe(materializeRecipe(input.recipesDir, input.recipe, outDir));

  const placeholders: Record<string, string> = {
    __APP_SLUG__: spec.slug,
    __APP_NAME__: spec.app_name.replace(/[<>{}"`]/g, ""),
    __APP_SUMMARY__: spec.summary.replace(/[<>{}"`]/g, ""),
  };
  for (const file of walk(outDir)) {
    if (file.includes("node_modules") || !TEXT_EXT.has(extname(file))) continue;
    let s = readFileSync(file, "utf8");
    let changed = false;
    for (const [k, v] of Object.entries(placeholders)) {
      if (s.includes(k)) {
        s = s.split(k).join(v);
        changed = true;
      }
    }
    if (changed) writeFileSync(file, s);
  }

  // Native components vendored with provenance: their files/ are copied into the app when selected.
  const componentsDir = join(input.recipesDir, "..", "components");
  const componentNav: { label: string; href: string }[] = [];
  for (const s of input.selected) {
    const files = join(componentsDir, s.component.id, "files");
    if (!s.component.pkg.name.startsWith("turbineh/") || !existsSync(files)) continue;
    cpSync(files, outDir, {
      recursive: true,
      filter: (src) => !src.endsWith(".env.example.append") && !src.endsWith("nav.json"),
    });
    const navFile = join(files, "nav.json");
    if (existsSync(navFile)) {
      componentNav.push(
        ...(JSON.parse(readFileSync(navFile, "utf8")) as { label: string; href: string }[]),
      );
    }
    const extraEnv = join(files, ".env.example.append");
    if (existsSync(extraEnv) && existsSync(join(outDir, ".env.example"))) {
      appendFileSync(join(outDir, ".env.example"), readFileSync(extraEnv, "utf8"));
    }
  }
  const componentTables = existsSync(join(outDir, "src/db"))
    ? readdirSync(join(outDir, "src/db"))
        .filter((f) => /^component-[a-z0-9-]+\.ts$/.test(f))
        .map((f) => f.replace(/\.ts$/, ""))
        .sort()
    : [];

  if (input.brand) applyBrand(outDir, input.brand);
  writeSiteContent(outDir, spec);

  const entities = entitiesToGenerate(spec, recipe.providedEntities);
  const chosen = new Set(input.selected.map((s) => s.capability));
  const features = {
    csvExport: chosen.has("data.csv-export"),
    csvImport: chosen.has("data.csv-import"),
  };
  const generated: GeneratedFile[] = [
    ...entities.flatMap((e) => generateEntity(e, features)),
    ...generateIndexes(entities, {
      recipeTables: existsSync(join(outDir, "src/db/recipe-tables.ts")),
      componentTables,
      extraNav: [...recipe.nav, ...componentNav],
    }),
    ...docs(
      input,
      entities.map((e) => entityNames(e.name).labelPlural),
      existsSync(join(outDir, ".env.example"))
        ? readFileSync(join(outDir, ".env.example"), "utf8")
        : "",
    ),
  ];
  for (const f of generated) {
    const p = join(outDir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
  }

  const generatedPaths = new Set(generated.map((f) => f.path));
  const files = walk(outDir)
    .filter(
      (p) =>
        !p.includes("node_modules") && TEXT_EXT.has(extname(p)) && !p.endsWith("pnpm-lock.yaml"),
    )
    .map((p) => {
      const rel = relative(outDir, p);
      return {
        path: rel,
        generated: generatedPaths.has(rel),
        lines: readFileSync(p, "utf8").split("\n").length,
      };
    });
  const code = files.filter((f) => /\.(ts|tsx|mjs|css)$/.test(f.path));
  return {
    files,
    generatedLines: code.filter((f) => f.generated).reduce((a, f) => a + f.lines, 0),
    reusedLines: code.filter((f) => !f.generated).reduce((a, f) => a + f.lines, 0),
  };
}

const MD = "<!-- turbineh:generated -->";

function docs(input: AssembleInput, entityLabels: string[], envExample: string): GeneratedFile[] {
  const { spec, selected, gaps, buildId } = input;
  const uniq = [...new Map(selected.map((s) => [s.component.id, s])).values()];
  const readme = `${MD}
# ${spec.app_name}

${spec.summary}

> **Start here:** open [START_HERE.html](START_HERE.html) in your browser. To put the app online: [DEPLOY.md](DEPLOY.md).

Generated by CODE-API-TURBINEH (build \`${buildId}\`, recipe \`${spec.recipe}\`) by **selecting verified components**
and generating only the glue. See [COMPONENTS.md](COMPONENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md),
[SECURITY.md](SECURITY.md) and [TURBINEH_REPORT.md](TURBINEH_REPORT.md).

## Features

${entityLabels.map((l) => `- ${l}: create, list and delete, scoped to your workspace`).join("\n")}
- Email + password sign-in, workspaces (organizations) and roles (owner, admin, member)

## Run locally

\`\`\`bash
cp .env.example .env.local      # set DATABASE_URL, BETTER_AUTH_SECRET (≥32 chars), BETTER_AUTH_URL
pnpm install
pnpm db:migrate
pnpm dev
\`\`\`

## Look and feel

Colours and typeface are theme tokens in \`src/app/globals.css\` (\`@theme\`: \`--color-brand\`, \`--font-brand\`); the
logo, if any, is in \`public/brand/\` and referenced from \`src/brand.ts\`. Change them there and every screen follows.

## Quality gates

\`pnpm typecheck\` · \`pnpm lint\` · \`pnpm test\` · \`pnpm build\` · \`pnpm test:e2e\`

## Acceptance criteria

${spec.acceptance_criteria.map((c) => `- ${c}`).join("\n")}
`;
  const components = `${MD}
# Components

Every component below comes from the TurbineH catalog (status \`approved\`), resolved deterministically for this
stack. "Decider" columns are the probabilities returned by the decision model for this build.

| Capability | Component | Package | License | Decider: best | covers | risk |
|---|---|---|---|---|---|---|
${selected
  .map(
    (s) =>
      `| ${s.capability} | ${s.component.id} | ${s.component.pkg.name}@${s.component.pkg.version} | ${s.component.license.detected} | ${s.why.pBest.toFixed(2)} | ${s.why.covers.toFixed(2)} | ${s.why.risk.toFixed(2)} |`,
  )
  .join("\n")}

${gaps.length ? `## Not covered by a catalog component\n\n${gaps.map((g) => `- \`${g.capability}\` (trigger ${g.trigger})`).join("\n")}\n` : ""}`;
  const architecture = `${MD}
# Architecture

- Recipe: \`${spec.recipe}\` — Next.js (App Router) + TypeScript (strict) + Tailwind + Drizzle + Postgres + better-auth + Zod.
- Multi-tenancy: every row carries \`organization_id\`; every query and action filters by the active workspace.
- Authorization: \`src/server/authz.ts\` (role policy) is called by every page and server action.
- Validation: Zod schemas at every boundary (\`src/entities/*/schema.ts\`, \`src/env.ts\`).
- Security Pack: \`src/security/\` (headers/CSP, rate limiting, safe errors).

\`\`\`
browser ──► Next.js pages/server actions ──► authz + zod ──► Drizzle ──► Postgres
                     │
                     └──► better-auth (sessions, organizations, roles)
\`\`\`

Components in use: ${uniq.map((s) => `\`${s.component.id}\``).join(", ")}.
`;
  return [
    { path: "README.md", content: readme },
    { path: "COMPONENTS.md", content: components },
    { path: "ARCHITECTURE.md", content: architecture },
    { path: "DEPLOY.md", content: `${MD}\n${deployGuide(spec.app_name, envExample)}` },
  ];
}

/** Writes SECURITY.md and TURBINEH_REPORT.md after verification (they report real results). */
export function writeReports(outDir: string, security: string, report: string): void {
  writeFileSync(join(outDir, "SECURITY.md"), `${MD}\n${security}`);
  writeFileSync(join(outDir, "TURBINEH_REPORT.md"), `${MD}\n${report}`);
}

/** START_HERE.html after verification: the client's entry point, with the real results. */
export function writeStartHere(outDir: string, facts: HandoverFacts): void {
  writeFileSync(join(outDir, "START_HERE.html"), startHereHtml(facts));
}

export function hasTemplate(dir: string): boolean {
  return existsSync(join(dir, "package.json"));
}
