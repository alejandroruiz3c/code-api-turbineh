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
  shippedRules,
  writeAcceptance,
  type CoverageRule,
} from "./acceptance.js";
import {
  fidelityCoverage,
  fidelityFiles,
  storedMatrix,
  strictCriteria,
  type FidelityAssembly,
} from "./fidelity.js";
import { generateByKind, type KindPlan } from "./kinds.js";
import { pascal } from "./naming.js";
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
  /**
   * Spec fidelity (ADR-0042, wired by ADR-0043): entity kinds, the role matrix, constraints and every detected domain
   * pattern (selected or missing). Absent = the generic CRUD generation of before.
   */
  fidelity?: FidelityAssembly;
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
  // Component adapters (ADR-0041), copied after every component's files/ so they win:
  //  - files-recipe/<recipe>/: glue for a recipe of the chain (e.g. the bookings recipe's home page);
  //  - files-with/<component>/: glue used only when that other component is in the app too.
  const selectedIds = new Set(input.selected.map((s) => s.component.id));
  const isMeta = (f: string) => /(^|\/)(\.env\.example\.append|nav\.json)$/.test(f);
  for (const s of input.selected) {
    if (!s.component.pkg.name.startsWith("turbineh/")) continue;
    const base = join(componentsDir, s.component.id);
    const overlays = [
      ...chain.map((m) => join(base, "files-recipe", m.id)),
      ...[...selectedIds].map((id) => join(base, "files-with", id)),
    ].filter((d) => existsSync(d));
    for (const dir of overlays) {
      cpSync(dir, outDir, { recursive: true, filter: (src) => !isMeta(src) });
      Object.assign(owners, ownersOf(dir, `component:${s.component.id}`, isMeta));
      const navFile = join(dir, "nav.json");
      if (existsSync(navFile))
        componentNav.push(
          ...(JSON.parse(readFileSync(navFile, "utf8")) as { label: string; href: string }[]),
        );
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
  const fid = input.fidelity;
  const kinds: KindPlan | null = fid ? planByKind(input, entities, features) : null;
  const entityFiles = kinds
    ? []
    : entities.map((e) => ({
        name: e.name,
        files: generateEntity(e, features, entities),
      }));
  for (const e of entityFiles) for (const f of e.files) owners[f.path] = `entity:${e.name}`;
  if (kinds) Object.assign(owners, kinds.owners);
  const matrix = fid ? storedMatrix(fid) : null;
  const fidelityOut = fid && matrix ? fidelityFiles(fid, matrix) : null;
  for (const f of fidelityOut?.files ?? []) owners[f.path] = "generated:fidelity";
  const generated: GeneratedFile[] = [
    ...entityFiles.flatMap((e) => e.files),
    ...(kinds?.files ?? []),
    ...(fidelityOut?.files ?? []),
    ...generateIndexes(entities, {
      recipeTables: existsSync(join(outDir, "src/db/recipe-tables.ts")),
      componentTables,
      extraNav: [...recipe.nav, ...componentNav],
      ...(kinds
        ? {
            nav: kinds.nav,
            tables: kinds.files
              .map((f) => /^src\/db\/tables\/([a-z0-9-]+)\.ts$/.exec(f.path)?.[1])
              .filter((x): x is string => Boolean(x)),
          }
        : {}),
    }),
    ...docs(
      input,
      kinds
        ? kinds.generatedAs.map((g) => featureLine(g))
        : entities.map((e) => `${entityNames(e.name).labelPlural}: create, list and delete, scoped to your workspace`),
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
  // Criterion → test: only tests shipped in this package (ADR-0043), each checked against its title and assertions.
  writeAcceptance(
    outDir,
    acceptanceStatus(
      spec.acceptance_criteria,
      shippedRules(outDir, [
        ...coverageRules(input),
        ...entityCoverage(
          outDir,
          entities.map((e) => e.name),
        ),
        ...(fidelityOut ? fidelityCoverage(outDir, fidelityOut.unit) : []),
      ]),
      null,
      strictCriteria(fid),
    ),
  );
  if (fid && matrix && kinds) writeFidelityReport(outDir, fid, matrix, kinds);
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
      components: [...selectedIds].map((id) => ({
        id,
        extend: readGuides(join(componentsDir, id))
          .filter((g) => !g.part)
          .flatMap((g) => g.extension_points ?? []),
      })),
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

${entityLabels.map((l) => `- ${l}`).join("\n")}
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

/** README line of a generated entity, by kind. */
function featureLine(g: KindPlan["generatedAs"][number]): string {
  const what = entityNames(g.entity).labelPlural;
  if (g.ui === "settings") return `${what}: a settings page (set per key, no list of records to delete)`;
  if (g.ui === "timeline") return `${what}: an append-only history shown on its parent's page`;
  if (g.ui === "parent") return `${what}: listed and added on its parent's page`;
  if (g.ui === "none") return `${what}: ${g.kind} — no page of its own (${g.where})`;
  if (g.ui === "crud + workflow")
    return `${what}: create, list and edit; status changes through its workflow (history, role-gated)`;
  return `${what}: create, list, edit and delete, scoped to your workspace`;
}

/** Entities generated by kind from the fidelity model, with workflows and the per-record scope of selected components. */
function planByKind(
  input: AssembleInput,
  entities: BuildSpec["entities"],
  features: { csvExport: boolean; csvImport: boolean },
): KindPlan {
  const fid = input.fidelity as FidelityAssembly;
  const selected = (id: string) =>
    fid.patterns.find((p) => p.id === id && p.status === "selected") ?? null;
  // Workflows of domain.workflow: the entity whose status field the workflow replaces, and its key.
  const workflows: Record<string, { key: string; field: string }> = {};
  const wf = selected("workflow");
  const defs = (wf?.params.workflows as { key: string }[] | undefined) ?? [];
  fid.fidelity.patterns
    .filter((p) => p.id === "workflow")
    .forEach((p, i) => {
      const entity = String(p.params.entity);
      const def = defs[i];
      const e = entities.find((x) => x.name === entity);
      const field = e?.fields.find((f) =>
        new RegExp(`^(current)?${String(p.params.field)}$`, "i").test(f.name),
      );
      if (def && e && field) workflows[entity] = { key: def.key, field: field.name };
    });
  // Per-record scope of domain.membership-access (company, project, shop).
  const membership = selected("membership-access");
  const scope = membership?.params.scope as { kind: string; label: string } | null | undefined;
  return generateByKind({
    entities,
    models: fid.fidelity.entities,
    features,
    sort: fid.fidelity.constraints.sort,
    workflows,
    scope: scope ? { entity: pascal(scope.kind), label: scope.label } : null,
  });
}

/** .turbineh/fidelity.json: how the request was modelled (kinds, roles, constraints, patterns) and what is left. */
function writeFidelityReport(
  outDir: string,
  fid: FidelityAssembly,
  matrix: ReturnType<typeof storedMatrix>,
  kinds: KindPlan,
): void {
  const report = {
    schema: "turbineh.fidelity/v1",
    entities: kinds.generatedAs,
    roles: Object.entries(matrix.roles).map(([key, r]) => ({ key, ...r })),
    rules: fid.fidelity.permissions.rules.map((r) => r.text),
    signUpEmailDomains: matrix.signUpEmailDomains,
    constraints: {
      timeZone: fid.fidelity.constraints.timeZone,
      currency: fid.fidelity.constraints.currency,
      assumptions: fid.fidelity.constraints.assumptions,
    },
    patterns: fid.patterns.map((p) => ({
      id: p.id,
      status: p.status,
      component: p.component,
      reason: p.reason,
      where: p.status === "missing" ? p.where : [],
      how: p.status === "missing" ? p.how : "",
    })),
    left: kinds.left,
  };
  mkdirSync(join(outDir, ".turbineh"), { recursive: true });
  writeFileSync(join(outDir, ".turbineh/fidelity.json"), `${JSON.stringify(report, null, 2)}\n`);
}

export function hasTemplate(dir: string): boolean {
  return existsSync(join(dir, "package.json"));
}
