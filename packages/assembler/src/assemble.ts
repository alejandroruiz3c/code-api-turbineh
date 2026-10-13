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
import { guideMarkdown, readGuides } from "@turbineh/catalog";
import type { BuildSpec } from "@turbineh/compiler";
import type { Candidate } from "@turbineh/resolver";
import { applyRequestedCurrencies } from "./currencies.js";
import {
  entitiesToGenerate,
  providedTables,
  generateEntity,
  generateIndexes,
  type GeneratedFile,
} from "./entities.js";
import { entityNames } from "./naming.js";
import { applyTheme, type Brand } from "./brand-theme.js";
import { writeSiteContent } from "./site-content.js";
import { deployGuide, startHereHtml, type HandoverFacts } from "./handover.js";
import { materializeRecipe, mergedRecipe, recipeChain } from "./recipes.js";
import {
  acceptanceStatus,
  readCoverage,
  writeAcceptance,
  type CoverageRule,
} from "./acceptance.js";
import { initialGuide, writeAgentGuide } from "./agent-guide.js";
import { ownersOf, recordOwners } from "./ownership.js";

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
  /** Domain components detected in the request by code (ADR-0033): parameters and the entities they implement. */
  domains?: {
    id: string;
    component: string;
    paramsFile: string;
    params: unknown;
    providedEntities: string[];
    assumptions?: string[];
  }[];
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
  const chain = materializeRecipe(input.recipesDir, input.recipe, outDir);
  const recipe = mergedRecipe(chain);
  // File ownership (ADR-0037 §D2): later layers win, exactly like the copies.
  const owners: Record<string, string> = {};
  for (const meta of chain)
    Object.assign(
      owners,
      ownersOf(join(input.recipesDir, meta.id, "template"), `recipe:${meta.id}`),
    );

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
    Object.assign(
      owners,
      ownersOf(files, `component:${s.component.id}`, (f) =>
        [".env.example.append", "nav.json"].includes(f),
      ),
    );
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
  // AI parts of components (files-ai/: toolkits, mock-model scripts, assistant E2E) only when the app has runAgent.
  const aiApp = existsSync(join(outDir, "src/lib/ai/agent.ts"));
  for (const s of input.selected) {
    const filesAi = join(componentsDir, s.component.id, "files-ai");
    if (aiApp && s.component.pkg.name.startsWith("turbineh/") && existsSync(filesAi)) {
      cpSync(filesAi, outDir, { recursive: true });
      Object.assign(owners, ownersOf(filesAi, `component:${s.component.id}`));
    }
  }
  // Domain parameters from the request (deterministic), e.g. src/bookings/params.json.
  for (const d of input.domains ?? []) {
    if (!input.selected.some((s) => s.component.id === d.component)) continue;
    const target = join(outDir, d.paramsFile);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(d.params, null, 2)}\n`);
    owners[d.paramsFile] = `component:${d.component}`;
  }
  if (aiApp) writeToolkits(outDir);
  // Component guides (ADR-0033) → docs/components/<id>[.<part>].md: what each component does, how to extend it.
  for (const id of new Set(input.selected.map((s) => s.component.id))) {
    for (const g of readGuides(join(componentsDir, id))) {
      if (g.part && !existsSync(join(outDir, g.part))) continue;
      const name = g.part
        ? `${id}.${g.part.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`
        : id;
      mkdirSync(join(outDir, "docs/components"), { recursive: true });
      writeFileSync(join(outDir, "docs/components", `${name}.md`), guideMarkdown(g));
      owners[`docs/components/${name}.md`] = `component:${id}`;
    }
  }

  const componentTables = existsSync(join(outDir, "src/db"))
    ? readdirSync(join(outDir, "src/db"))
        .filter((f) => /^component-[a-z0-9-]+\.ts$/.test(f))
        .map((f) => f.replace(/\.ts$/, ""))
        .sort()
    : [];

  // Theme tokens from the request's palette (and the uploaded brand, which wins): every build, every recipe.
  applyTheme(outDir, { brand: input.brand ?? null, palette: spec.palette ?? null });
  writeSiteContent(outDir, spec);
  applyRequestedCurrencies(outDir, spec);

  const entities = entitiesToGenerate(spec, [
    ...recipe.providedEntities,
    ...providedTables(outDir),
    ...(input.domains ?? []).flatMap((d) => d.providedEntities),
  ]);
  const chosen = new Set(input.selected.map((s) => s.capability));
  const features = {
    csvExport: chosen.has("data.csv-export"),
    csvImport: chosen.has("data.csv-import"),
  };
  const entityFiles = entities.map((e) => ({
    name: e.name,
    files: generateEntity(e, features, entities),
  }));
  for (const e of entityFiles) for (const f of e.files) owners[f.path] = `entity:${e.name}`;
  const generated: GeneratedFile[] = [
    ...entityFiles.flatMap((e) => e.files),
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
    owners[f.path] ??= "generated";
  }
  recordOwners(outDir, owners);
  writeAcceptance(
    outDir,
    acceptanceStatus(spec.acceptance_criteria, [
      ...coverageRules(input),
      ...entityCoverage(
        outDir,
        entities.map((e) => e.name),
      ),
    ]),
  );
  // Agent guide (AGENTS.md + turbineh.json): structure now, gate results and criteria proofs after verification.
  writeAgentGuide(
    outDir,
    initialGuide({
      outDir,
      buildId: input.buildId,
      app: { name: placeholders.__APP_NAME__ ?? spec.app_name, summary: spec.summary },
      recipe: {
        id: recipe.id,
        description: recipe.description,
        ...(recipe.guide ? { guide: recipe.guide } : {}),
      },
      criteria: spec.acceptance_criteria,
      gaps: input.gaps,
    }),
  );

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
>
> **Coding agents:** read [AGENTS.md](AGENTS.md) first — what is done (with the test that proves it), what is left, where
> each feature lives, how to extend it and what to re-run. The same facts are in [turbineh.json](turbineh.json).

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

Colours and typeface are theme tokens in \`src/app/globals.css\` (\`@theme\`: \`--color-surface\`, \`--color-panel\`,
\`--color-ink\`, \`--color-brand\`, \`--color-accent\`, \`--font-brand\`…; components use only these); the
logo, if any, is in \`public/brand/\` and referenced from \`src/brand.ts\`. Change them there and every screen follows.

## Quality gates

\`pnpm typecheck\` · \`pnpm lint\` · \`pnpm test\` · \`pnpm build\` · \`pnpm test:e2e\`

${
  (input.domains ?? []).some((d) => d.assumptions?.length)
    ? `## Defaults used (the request did not say)\n\n${(input.domains ?? [])
        .flatMap((d) => d.assumptions ?? [])
        .map((a) => `- ${a}`)
        .join("\n")}\n\n`
    : ""
}## Acceptance criteria

${spec.acceptance_criteria.length} criteria from the request. Which test proves each one, or where to implement and prove
it: [ACCEPTANCE.md](ACCEPTANCE.md) (the same facts as AGENTS.md, updated after verification).

\`pnpm dev\`, \`pnpm db:migrate\` and \`pnpm test:e2e\` need no database setup: without \`DATABASE_URL\` they use a local
PostgreSQL (\`pnpm db:local\`).
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

/** Test titles with their key steps and assertions (form fields filled, expect lines), in file order. */
export function testBlocks(src: string): { title: string; assertions: string[] }[] {
  const starts = [...src.matchAll(/test\(\s*"([^"]{5,200})"/g)];
  return starts.map((m, i) => {
    const body = src.slice(m.index, starts[i + 1]?.index ?? src.length);
    const assertions = body
      .split("\n")
      .filter((l) => /expect\(|getByLabel\(/.test(l))
      .map((l) => l.trim().slice(0, 200));
    return { title: m[1] as string, assertions };
  });
}

/**
 * Coverage rules for the generated entities (ADR-0035): each generated spec proves create / edit / CSV export / CSV
 * import of its entity, so a criterion that names the entity and the action is proven by that test.
 */
export function entityCoverage(outDir: string, entityNamesList: string[]): CoverageRule[] {
  const esc = (s: string) => s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const actions: [RegExp, string][] = [
    [/^owner creates a /, "creat|add|new|record|enter|log|submit|register"],
    [/^owner edits a /, "edit|updat|chang|modif|correct"],
    [/ export as CSV/, "export|download|csv"],
    [/ import from CSV/, "import|upload|csv"],
  ];
  return entityNamesList.flatMap((name) => {
    const n = entityNames(name);
    const file = `tests/e2e/${n.slug}.spec.ts`;
    if (!existsSync(join(outDir, file))) return [];
    const src = readFileSync(join(outDir, file), "utf8");
    const blocks = testBlocks(src);
    const entity = `\\b(${esc(n.labelSingular)}|${esc(n.labelPlural)})\\b`;
    return actions.flatMap(([re, verbs]) =>
      blocks
        .filter((b) => re.test(b.title))
        .map((b) => ({
          test: `${file} › ${b.title}`,
          covers: [entity, verbs],
          from: "generated",
          proof: b,
        })),
    );
  });
}

/** Coverage rules of the recipe chain and of every native component in the app (acceptance.yaml files). */
export function coverageRules(
  input: Pick<AssembleInput, "recipesDir" | "recipe" | "selected">,
): CoverageRule[] {
  const componentsDir = join(input.recipesDir, "..", "components");
  return [
    ...recipeChain(input.recipesDir, input.recipe).flatMap((m) =>
      readCoverage(join(input.recipesDir, m.id, "acceptance.yaml"), `recipe ${m.id}`),
    ),
    ...[...new Set(input.selected.map((s) => s.component.id))].flatMap((id) =>
      readCoverage(join(componentsDir, id, "acceptance.yaml"), id),
    ),
  ];
}

/** src/lib/ai/toolkits.ts: every installed domain toolkit (src/<domain>/toolkit.ts exporting `toolkit`). */
export function writeToolkits(outDir: string): string[] {
  const src = join(outDir, "src");
  const domains = readdirSync(src)
    .filter((d) => /^[a-z][a-z0-9-]*$/.test(d) && existsSync(join(src, d, "toolkit.ts")))
    .sort();
  const ident = (d: string) =>
    `${d.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())}Toolkit`;
  writeFileSync(
    join(src, "lib/ai/toolkits.ts"),
    [
      "// turbineh:generated",
      'import type { Toolkit } from "./agent";',
      ...domains.map((d) => `import { toolkit as ${ident(d)} } from "@/${d}/toolkit";`),
      "",
      "/** Toolkits installed in this app (ADR-0033): one per domain component that exposes tools to runAgent. */",
      `export const TOOLKITS: Toolkit[] = [${domains.map(ident).join(", ")}];`,
      "",
    ].join("\n"),
  );
  return domains;
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
