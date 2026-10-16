import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { componentDocsSchema, DOCS_SCHEMA, type ComponentDocs } from "@turbineh/catalog";
import {
  componentSnippet,
  repairImportSignatures,
  usageSources,
  type Snippet,
} from "@turbineh/catalog/snippets";
import OpenAI from "openai";
import { parse, stringify } from "yaml";
import { z } from "zod";

/**
 * Intake documentation step (ADR-0032 §Documentation). A component that is not documented to our standard is not
 * rejected: we document it. Facts come from code (manifest, exports, env vars, dependencies, tests); our open model
 * drafts only the narrative sections from those facts and the package README; every drafted claim that can be
 * checked against the facts is checked, and anything the code does not support is dropped.
 */

interface Manifest {
  id: string;
  source: { purl: string; repo?: string };
  capability: { does: string; does_not?: string; use_cases?: string[] };
  compat?: { runtime?: string; peer?: Record<string, string> };
  effects?: { network?: boolean; fs?: boolean; db?: boolean; external_services?: string[] };
  integration?: { install?: string; config?: string[] };
  license: { declared: string; detected: string };
  security?: { scanned_at?: string; findings?: unknown[] };
  relations: { requires: string[]; provides: string[]; conflicts: string[] };
}

/**
 * Joins summary parts sentence by sentence, dropping repeats (the drafted summary often restates the manifest's
 * `does` / `does_not`), so a guide never says the same thing twice.
 */
export function joinSentences(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    for (const raw of part.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)) {
      const sentence = raw.trim().replace(/\.$/, "");
      const key = sentence.toLowerCase();
      if (!sentence || seen.has(key)) continue;
      seen.add(key);
      out.push(`${sentence}.`);
    }
  }
  return out.join(" ");
}

export interface ComponentFacts {
  id: string;
  /** The public usage snippet from the component's own contract test or snippet.ts (ADR-0066), when it has one. */
  snippet?: Snippet | null;
  /** Full sources of that usage (contract test, snippet.ts): the real import of each package name. */
  usage?: string[];
  manifest: Manifest;
  pkg: { name: string; version: string };
  /** Names the code really exposes or uses from the package (imports in tests/glue, exports of glue/files). */
  symbols: string[];
  /** Import specifier → names importable from it (the package itself, the curated glue, native files). */
  importable: Record<string, string[]>;
  /** Real signature and import specifier of each name (declaration line, or the import from the package). */
  signatures: Record<string, { signature: string; where: string }>;
  /** Interface kind of each exported name, from its declaration. */
  kinds: Record<string, "export" | "route" | "component" | "hook" | "type">;
  env: string[];
  tests: { file: string; title: string }[];
  /** Short source excerpts (contract test, glue) for the model. */
  code: string;
  readme: string;
  catalogIds: string[];
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Imported names from `pkg` and exported names of a source text. */
export function symbolsOf(src: string, pkg: string): string[] {
  const out = new Set<string>();
  const esc = pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  for (const m of src.matchAll(
    new RegExp(`import\\s+([^;]*?)\\s+from\\s+["']${esc}(?:/[^"']*)?["']`, "g"),
  )) {
    const clause = m[1] ?? "";
    const def = /^([A-Za-z_$][\w$]*)/.exec(clause.replace(/^type\s+/, ""));
    if (def?.[1] && !clause.startsWith("{") && !clause.startsWith("*")) out.add(def[1]);
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (ns?.[1]) out.add(ns[1]);
    for (const n of /\{([^}]*)\}/.exec(clause)?.[1]?.split(",") ?? []) {
      const name = n
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) out.add(name);
    }
  }
  for (const m of src.matchAll(
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/g,
  ))
    out.add(m[1] as string);
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g))
    out.add(m[1] as string);
  return [...out];
}

/** Names imported from `pkg` (default, named; for a namespace import `* as A`, the members used as `A.Name`). */
export function importsFrom(src: string, pkg: string): string[] {
  const own = new Set(symbolsOf(src, pkg));
  for (const e of exportsOf(src)) own.delete(e.name);
  const esc = pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  for (const m of src.matchAll(
    new RegExp(`import\\s+\\*\\s+as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+["']${esc}["']`, "g"),
  )) {
    const ns = m[1] as string;
    own.delete(ns);
    for (const u of src.matchAll(new RegExp(`\\b${ns}\\.([A-Za-z_$][\\w$]*)`, "g")))
      own.add(u[1] as string);
  }
  return [...own];
}

/** Exported declarations with their interface kind. */
export function exportsOf(
  src: string,
  tsx = false,
): { name: string; kind: "export" | "route" | "component" | "hook" | "type" }[] {
  return [
    ...src.matchAll(
      /export\s+(default\s+)?(?:async\s+)?(function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/g,
    ),
  ].map((m) => {
    const name = m[3] as string;
    const decl = m[2] as string;
    const kind =
      decl === "interface" || decl === "type"
        ? ("type" as const)
        : /^(GET|POST|PUT|PATCH|DELETE)$/.test(name)
          ? ("route" as const)
          : /^use[A-Z]/.test(name)
            ? ("hook" as const)
            : tsx && /^[A-Z]/.test(name)
              ? ("component" as const)
              : ("export" as const);
    return { name, kind };
  });
}

export function envOf(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) out.add(m[1] as string);
  for (const m of src.matchAll(/^\s{2,6}([A-Z][A-Z0-9_]{2,}):\s*z\./gm)) out.add(m[1] as string);
  for (const m of src.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) out.add(m[1] as string);
  return [...out].filter((e) => e !== "NODE_ENV");
}

export function testsOf(dir: string): { file: string; title: string }[] {
  return walk(dir)
    .filter((p) => /\.(test|spec)\.tsx?$/.test(p))
    .flatMap((p) => {
      const src = readFileSync(p, "utf8");
      return [...src.matchAll(/\b(?:it|test)\(\s*["'`]([^"'`]{3,200})["'`]/g)].map((m) => ({
        file: relative(dir, p),
        title: m[1] as string,
      }));
    });
}

async function readme(name: string): Promise<string> {
  if (name.startsWith("turbineh/")) return "";
  try {
    const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json()) as { readme?: string; description?: string };
    // Text only: the README is read as data, never executed.
    return `${j.description ?? ""}\n${(j.readme ?? "").replace(/<[^>]+>/g, "").slice(0, 3500)}`;
  } catch {
    return "";
  }
}

/**
 * Files named by a vendored component's install note (e.g. "Included in recipe templates at src/lib/csv.ts"), found
 * in the recipe templates, and the template unit tests that import them.
 */
export function vendoredFiles(
  componentsDir: string,
  install: string,
): {
  files: { abs: string; spec: string }[];
  tests: { abs: string; rel: string }[];
  base: boolean;
} {
  const recipes = join(componentsDir, "../recipes");
  if (!existsSync(recipes)) return { files: [], tests: [], base: false };
  const templates = readdirSync(recipes).map((r) => join(recipes, r, "template"));
  const files: { abs: string; spec: string }[] = [];
  for (const path of install.match(/\bsrc\/[\w./-]+/g) ?? []) {
    const clean = path.replace(/\/$/, "");
    for (const t of templates) {
      const abs = join(t, clean);
      if (!existsSync(abs)) continue;
      const list = statSync(abs).isDirectory()
        ? walk(abs).filter((x) => /\.(ts|tsx)$/.test(x))
        : [abs];
      for (const f of list) {
        const spec = `@/${relative(join(t, "src"), f).replace(/\.(ts|tsx)$/, "")}`;
        if (!files.some((x) => x.spec === spec)) files.push({ abs: f, spec });
      }
      break;
    }
  }
  const specs = new Set(files.map((f) => f.spec));
  const tests: { abs: string; rel: string }[] = [];
  for (const t of templates) {
    for (const f of walk(join(t, "tests/unit")).filter((x) => x.endsWith(".test.ts"))) {
      const src = readFileSync(f, "utf8");
      const imports = [...src.matchAll(/(?:from\s+|import\(\s*)["'](@\/[^"']+)["']/g)].map(
        (m) => m[1] as string,
      );
      if (imports.some((i) => specs.has(i)) && !tests.some((x) => x.rel.endsWith(relative(t, f))))
        tests.push({
          abs: f,
          rel: `recipe template ${relative(join(t, "../.."), join(t, ".."))}/${relative(t, f)}`,
        });
    }
  }
  return { files, tests, base: files.some((f) => f.abs.includes(`/recipes/${BASE}/`)) };
}

const BASE = "saas-crud";

/**
 * Packages of the base template stack (e.g. better-auth, zod, drizzle-orm): the names the templates import from them
 * and the base template's tests, which exercise that stack in every build.
 */
export function stackFacts(
  componentsDir: string,
  pkg: string,
): { names: string[]; tests: { abs: string; rel: string }[] } {
  const base = join(componentsDir, "../recipes", BASE, "template");
  const pj = join(base, "package.json");
  const tests = [...walk(join(base, "tests"))]
    .filter((f) => /\.(test|spec)\.ts$/.test(f))
    .map((f) => ({ abs: f, rel: `recipe template ${BASE}/${relative(base, f)}` }));
  if (!existsSync(pj)) return { names: [], tests };
  const deps = (JSON.parse(readFileSync(pj, "utf8")) as { dependencies?: Record<string, string> })
    .dependencies;
  if (!deps || !(pkg in deps)) return { names: [], tests };
  const recipes = join(componentsDir, "../recipes");
  const src = readdirSync(recipes)
    .flatMap((r) => walk(join(recipes, r, "template/src")))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  return { names: importsFrom(src, pkg), tests };
}

/** Bounds the model's draft (truncates over-long strings and lists) before validation. */
export function boundDraft(raw: unknown): unknown {
  const cut = (v: unknown, n: number): unknown => (typeof v === "string" ? v.slice(0, n) : v);
  if (!raw || typeof raw !== "object") return raw;
  const d = { ...(raw as Record<string, unknown>) };
  const arr = (k: string, max: number, n = 300) => {
    if (Array.isArray(d[k])) d[k] = (d[k] as unknown[]).slice(0, max).map((x) => cut(x, n));
  };
  arr("use_cases", 6);
  arr("when_to_use", 4);
  arr("tradeoffs", 4);
  arr("extension_points", 4);
  arr("security", 4);
  arr("limits", 4);
  if (Array.isArray(d.keywords))
    d.keywords = (d.keywords as unknown[])
      .filter((k) => typeof k === "string" && k.length <= 40)
      .slice(0, 20);
  for (const k of ["when_not_to_use", "interfaces", "guarantees"]) {
    if (Array.isArray(d[k]))
      d[k] = (d[k] as Record<string, unknown>[])
        .slice(0, k === "interfaces" ? 8 : k === "guarantees" ? 6 : 4)
        .map((o) =>
          Object.fromEntries(Object.entries(o ?? {}).map(([kk, vv]) => [kk, cut(vv, 300)])),
        );
  }
  d.example = cut(d.example, 1200);
  return d;
}

/** Deterministic facts of one component. */
export async function componentFacts(
  componentsDir: string,
  id: string,
  fetchReadme = true,
): Promise<ComponentFacts> {
  const dir = join(componentsDir, id);
  const manifest = parse(readFileSync(join(dir, "component.yaml"), "utf8")) as Manifest;
  const purl = /^pkg:[a-z]+\/(.+)@([^@]+)$/.exec(manifest.source.purl);
  const pkg = {
    name: decodeURIComponent(purl?.[1] ?? `turbineh/${id}`),
    version: purl?.[2] ?? "0.0.0",
  };
  // Components vendored in the recipe templates ("Included in recipe templates at src/…"): their code and unit
  // tests live in the templates.
  const vendored = vendoredFiles(componentsDir, manifest.integration?.install ?? "");
  const sources = [
    ...walk(dir).filter((p) => /\.(ts|tsx|mjs)$/.test(p) || p.endsWith(".append")),
    ...vendored.files.map((f) => f.abs),
    ...vendored.tests.map((t) => t.abs),
  ];
  const all = sources.map((p) => readFileSync(p, "utf8")).join("\n");
  const importable: Record<string, string[]> = {};
  const stack = stackFacts(componentsDir, pkg.name);
  const kinds: ComponentFacts["kinds"] = {};
  if (!pkg.name.startsWith("turbineh/")) {
    importable[pkg.name] = [...new Set([...importsFrom(all, pkg.name), ...stack.names])];
    for (const n of importable[pkg.name] ?? []) kinds[n] = /^use[A-Z]/.test(n) ? "hook" : "export";
  }
  for (const f of vendored.files) {
    const ex = exportsOf(readFileSync(f.abs, "utf8"), f.abs.endsWith(".tsx"));
    if (ex.length === 0) continue;
    importable[f.spec] = ex.map((e) => e.name);
    for (const e of ex) kinds[e.name] = e.kind;
  }
  const glue = join(dir, "glue.ts");
  if (existsSync(glue)) {
    const cap = manifest.relations.provides[0] ?? id;
    const spec = `@/integrations/${cap.replace(/\./g, "-")}`;
    const ex = exportsOf(readFileSync(glue, "utf8"), cap.startsWith("ui."));
    importable[spec] = ex.map((e) => e.name);
    for (const e of ex) kinds[e.name] = e.kind;
  }
  for (const f of walk(join(dir, "files/src")).filter((x) => /\.(ts|tsx)$/.test(x))) {
    const spec = `@/${relative(join(dir, "files/src"), f).replace(/\.(ts|tsx)$/, "")}`;
    const ex = exportsOf(readFileSync(f, "utf8"), f.endsWith(".tsx"));
    if (ex.length === 0) continue;
    importable[spec] = ex.map((e) => e.name);
    for (const e of ex) kinds[e.name] = e.kind;
  }
  const symbols = [...new Set(Object.values(importable).flat())];
  const signatures: ComponentFacts["signatures"] = {};
  const declSources: [string, string][] = [
    ...vendored.files.map((f) => [f.spec, readFileSync(f.abs, "utf8")] as [string, string]),
    ...(existsSync(glue)
      ? [
          [
            `@/integrations/${(manifest.relations.provides[0] ?? id).replace(/\./g, "-")}`,
            readFileSync(glue, "utf8"),
          ] as [string, string],
        ]
      : []),
    ...walk(join(dir, "files/src"))
      .filter((x) => /\.(ts|tsx)$/.test(x))
      .map(
        (f) =>
          [
            `@/${relative(join(dir, "files/src"), f).replace(/\.(ts|tsx)$/, "")}`,
            readFileSync(f, "utf8"),
          ] as [string, string],
      ),
  ];
  for (const [spec, src] of declSources) {
    for (const name of importable[spec] ?? []) {
      const m = new RegExp(
        `export\\s+(?:default\\s+)?((?:async\\s+)?(?:function|const|class|interface|type)\\s+${name}\\b[^{=;]*)`,
      ).exec(src);
      signatures[name] = {
        signature: (m?.[1] ?? name).replace(/\s+/g, " ").trim().slice(0, 240),
        where: spec,
      };
    }
  }
  if (!pkg.name.startsWith("turbineh/")) {
    for (const name of importable[pkg.name] ?? [])
      signatures[name] ??= { signature: `import { ${name} } from "${pkg.name}"`, where: pkg.name };
  }
  const env = [
    ...new Set([
      ...envOf(all),
      ...(manifest.integration?.config ?? []).filter((c) => /^[A-Z][A-Z0-9_]+$/.test(c)),
    ]),
  ];
  const excerpt = sources
    .filter((p) => /contract\.test\.ts$|glue\.ts$|\/src\/lib\/[^/]+\.ts$/.test(p))
    .slice(0, 4)
    .map((p) => `// ${relative(dir, p)}\n${readFileSync(p, "utf8").slice(0, 1800)}`)
    .join("\n\n");
  return {
    id,
    snippet: componentSnippet(dir),
    usage: usageSources(dir),
    manifest,
    pkg,
    symbols,
    importable,
    signatures,
    kinds,
    env,
    tests: [
      ...testsOf(dir),
      ...[...vendored.tests, ...(stack.names.length || vendored.base ? stack.tests : [])].flatMap(
        (t) =>
          [
            ...readFileSync(t.abs, "utf8").matchAll(/\b(?:it|test)\(\s*["'`]([^"'`]{3,200})["'`]/g),
          ].map((m) => ({ file: t.rel, title: m[1] as string })),
      ),
    ],
    code: excerpt,
    readme: fetchReadme ? await readme(pkg.name) : "",
    catalogIds: readdirSync(componentsDir),
  };
}

/** Bounded strings keep a degenerate generation from running away (the JSON schema carries the limits). */
const S = z.string().max(300);
/** What the open model drafts (narrative only; facts are never taken from it). */
export const draftSchema = z.object({
  title: S,
  summary: z.string().max(600),
  use_cases: z.array(S).min(2).max(6),
  when_to_use: z.array(S).min(1).max(4),
  when_not_to_use: z
    .array(z.object({ instead: S, why: S }))
    .min(1)
    .max(4),
  tradeoffs: z
    .array(z.object({ choice: S, gain: S, cost: S }))
    .min(1)
    .max(4),
  interfaces: z
    .array(z.object({ name: S, about: S }))
    .min(1)
    .max(8),
  extension_points: z.array(z.object({ what: S, where: S, how: S })).max(4),
  security: z.array(S).max(4),
  guarantees: z
    .array(z.object({ claim: S, test_title: S }))
    .min(1)
    .max(6),
  limits: z.array(S).min(1).max(4),
  example: z.string().max(1200),
  keywords: z.array(z.string().max(40)).min(5).max(20),
  synonyms: z.array(z.object({ term: S, also: z.array(S).max(5) })).max(5),
});
export type Draft = z.infer<typeof draftSchema>;

const SYSTEM =
  "You document one software component for engineers and for an automated selector. Use ONLY the facts given " +
  "(manifest, code, tests, README). Never invent APIs, options, env vars or guarantees. Interfaces must be names " +
  "from `import_from`. Each guarantee must quote one exact title from `tests`. `when_not_to_use.instead` names another " +
  "catalog component id from `alternatives` or a plain approach. The example is short TypeScript that imports " +
  "only names listed in `import_from` from exactly that specifier. Plain, specific English; no marketing. Answer with JSON only.";

export function draftPrompt(f: ComponentFacts): string {
  const alternatives = f.catalogIds.filter(
    (c) =>
      c !== f.id &&
      f.manifest.relations.provides.some(
        (p) => c.startsWith(`${p}.`) || c.startsWith(p.split(".")[0] + "."),
      ),
  );
  return JSON.stringify({
    component: f.id,
    package: `${f.pkg.name}@${f.pkg.version}`,
    does: f.manifest.capability.does,
    does_not: f.manifest.capability.does_not ?? "",
    provides: f.manifest.relations.provides,
    effects: f.manifest.effects ?? {},
    license: f.manifest.license.detected,
    import_from: f.importable,
    // Routes the component adds (an example may show how to open or call them).
    routes: Object.keys(f.importable)
      .filter((k) => k.startsWith("@/app/"))
      .map((k) => `/${k.slice("@/app/".length).split("/").slice(0, -1).join("/")}`),
    env: f.env,
    tests: f.tests.map((t) => t.title),
    alternatives: alternatives.slice(0, 12),
    code: f.code.slice(0, 5000),
    readme: f.readme.slice(0, 3500),
  });
}

/** Deterministic check of a draft against the facts: unsupported claims are dropped, not kept. */
export function checkDraft(
  f: ComponentFacts,
  d: Draft,
  meta: { by: string; at: string },
): { docs: ComponentDocs; dropped: string[] } {
  const dropped: string[] = [];
  const clean = (xs: string[], max = 400) =>
    [...new Set(xs.map((x) => x.trim().replace(/\s+/g, " ")).filter((x) => x.length >= 3))].map(
      (x) => x.slice(0, max),
    );
  const symbols = new Set(f.symbols);
  const interfaces = d.interfaces.flatMap((i) => {
    const name = i.name.replace(/\(.*$/, "").trim();
    const sig = f.signatures[name];
    if (!symbols.has(name) || !sig) {
      dropped.push(`interface ${i.name} (not in the code)`);
      return [];
    }
    return [{ name, signature: sig.signature, where: sig.where }];
  });
  // Import signatures as the component's own usage really imports each name (default vs named, subpath).
  const realInterfaces = repairImportSignatures(interfaces, f.usage ?? []);
  const guarantees = d.guarantees.flatMap((g) => {
    const t = f.tests.find((x) => x.title === g.test_title.trim());
    if (!t) {
      dropped.push(`guarantee "${g.claim}" (no test titled "${g.test_title}")`);
      return [];
    }
    return [{ claim: g.claim.slice(0, 400), test: `${t.file} › ${t.title}` }];
  });
  const whenNot = d.when_not_to_use.filter((w) => {
    const looksLikeId = /^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$/.test(w.instead.trim());
    if (looksLikeId && !f.catalogIds.includes(w.instead.trim())) {
      dropped.push(`alternative ${w.instead} (not in the catalog)`);
      return false;
    }
    return true;
  });
  // The example is never model-written when the component has its own usage (contract test or snippet.ts): it is that
  // usage, compiled afterwards by `pnpm catalog:snippets` (ADR-0066).
  const fixedExample = repairImports(d.example, f.importable);
  const exampleIssue = f.snippet ? null : exampleProblem(fixedExample, f.importable);
  const example =
    f.snippet?.code.trim() ??
    (exampleIssue ? "" : fixedExample.trim().split("\n").slice(0, 30).join("\n"));
  if (exampleIssue)
    dropped.push(`example (${exampleIssue}): ${JSON.stringify(d.example.slice(0, 160))}`);
  const m = f.manifest;
  const security = [
    `Licence ${m.license.detected}${m.security?.scanned_at ? `; ${m.security.findings?.length ?? 0} known advisories (OSV) on ${m.security.scanned_at}` : ""}.`,
    `Effects: network ${m.effects?.network ? "yes" : "no"}, filesystem ${m.effects?.fs ? "yes" : "no"}, database ${m.effects?.db ? "yes" : "no"}${m.effects?.external_services?.length ? `; external services: ${m.effects.external_services.join(", ")}` : ""}.`,
    ...clean(d.security),
  ];
  const synonyms = Object.fromEntries(
    d.synonyms
      .filter((x) => x.term.trim() && x.also.length)
      .map((x) => [x.term.trim().toLowerCase(), clean(x.also, 60)]),
  );
  const docs: ComponentDocs = {
    schema: DOCS_SCHEMA,
    component: f.id,
    title: d.title.trim() || m.capability.does,
    summary: joinSentences([m.capability.does, m.capability.does_not ?? "", d.summary]),
    keywords: [
      ...new Set(
        [
          // Deterministic: package name, capability ids and their words.
          f.pkg.name.replace(/^turbineh\//, ""),
          ...m.relations.provides,
          ...m.relations.provides.flatMap((p) => p.split(/[.-]/)),
          ...d.keywords,
        ]
          .map((k) => k.toLowerCase().trim())
          .filter((k) => k.length >= 2 && k.length <= 40),
      ),
    ].slice(0, 30),
    ...(Object.keys(synonyms).length ? { synonyms } : {}),
    use_cases: clean(d.use_cases),
    use_when: clean(d.when_to_use),
    avoid_when: whenNot.map((w) =>
      `${w.why.trim().replace(/\.$/, "")} — use ${w.instead.trim()}`.slice(0, 400),
    ),
    tradeoffs: d.tradeoffs
      .map((t) => ({ choice: t.choice.trim(), gain: t.gain.trim(), cost: t.cost.trim() }))
      .filter((t) => t.choice.length >= 3 && t.gain.length >= 3 && t.cost.length >= 3),
    config: [
      ...(m.integration?.install
        ? [
            {
              name: "install",
              description: `${m.integration.install} (exact version, added by TurbineH)`,
            },
          ]
        : []),
      ...f.env.map((e) => ({
        name: e,
        description: "Environment variable read by the component's code.",
      })),
    ],
    interfaces: realInterfaces,
    extension_points: d.extension_points
      .map((e) => ({ what: e.what.trim(), where: e.where.trim(), how: e.how.trim() }))
      .filter((e) => e.what.length >= 3 && e.where && e.how.length >= 3),
    compatibility: {
      package: `${f.pkg.name}@${f.pkg.version}`,
      ...(m.compat?.runtime ? { runtime: m.compat.runtime } : {}),
      ...(Object.keys(m.compat?.peer ?? {}).length ? { peers: m.compat?.peer } : {}),
      stack: "Verified with Next.js (App Router), TypeScript strict, pnpm",
      ...(m.relations.requires.length ? { requires: m.relations.requires } : {}),
      ...(m.relations.conflicts.length ? { conflicts: m.relations.conflicts } : {}),
    },
    security,
    guarantees,
    limits: clean(d.limits),
    example,
    generated: {
      by: meta.by,
      at: meta.at,
      sections: [
        "title",
        "summary (after the manifest's does / does_not)",
        "keywords (after package and capability ids)",
        "synonyms",
        "use_cases",
        "use_when",
        "avoid_when",
        "tradeoffs",
        "extension_points",
        "security (after licence and effects)",
        "guarantees",
        "limits",
        ...(f.snippet ? [] : ["example"]),
      ],
      checked: [
        "interfaces: names exist in the code; signatures copied from the declarations",
        "guarantees: exact test titles in the component's tests",
        "avoid_when alternatives exist in the catalog",
        f.snippet
          ? "example: the component's contract test or snippet.ts, compiled (example_check)"
          : "example imports only what the component provides",
        "config, compatibility, licence and effects come from the code and manifest",
      ],
    },
  };
  return { docs, dropped };
}

/**
 * Deterministic repair of an example's import specifiers: when every name of a named import exists in exactly one
 * specifier the component provides, the import is rewritten to that specifier (the names are the code's; only the
 * path the model guessed is corrected). Anything else is left for exampleProblem() to judge.
 */
export function repairImports(example: string, importable: Record<string, string[]>): string {
  return example.replace(
    /import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["'];?/g,
    (whole, names: string, from: string) => {
      if (importable[from]) return whole;
      const wanted = names
        .split(",")
        .map(
          (n) =>
            n
              .trim()
              .replace(/^type\s+/, "")
              .split(/\s+as\s+/)[0]
              ?.trim() ?? "",
        )
        .filter(Boolean);
      const bySpec = new Map<string, string[]>();
      for (const n of wanted) {
        const specs = Object.entries(importable)
          .filter(([, ns]) => ns.includes(n))
          .map(([k]) => k);
        if (specs.length !== 1) return whole;
        bySpec.set(specs[0] as string, [...(bySpec.get(specs[0] as string) ?? []), n]);
      }
      return [...bySpec]
        .map(([spec, ns]) => `import { ${ns.join(", ")} } from "${spec}";`)
        .join("\n");
    },
  );
}

/** Why an example is not supported by the code (imports from unknown specifiers or of unknown names), or null. */
export function exampleProblem(
  example: string,
  importable: Record<string, string[]>,
): string | null {
  const imports = [...example.matchAll(/import\s+([^;]*?)\s+from\s+["']([^"']+)["']/g)];
  if (imports.length === 0) {
    // Page components: an example may show the route the component adds (e.g. /dashboard/billing).
    const routes = Object.keys(importable)
      .filter((k) => k.startsWith("@/app/"))
      .map((k) => `/${k.slice("@/app/".length).split("/").slice(0, -1).join("/")}`)
      .filter((r) => r.length > 1);
    return routes.some((r) => example.includes(r)) ? null : "imports nothing from the component";
  }
  for (const m of imports) {
    const from = m[2] as string;
    // A package subpath ("@hookform/resolvers/zod") belongs to its package.
    const key = Object.keys(importable).find((k) => from === k || from.startsWith(`${k}/`));
    const names = key ? importable[key] : undefined;
    if (!names) return `imports from ${from}, which the component does not provide`;
    const clause = (m[1] ?? "").replace(/^type\s+/, "");
    const wanted = [
      ...(/^([A-Za-z_$][\w$]*)/.exec(clause)?.[1] && !clause.startsWith("{")
        ? [/^([A-Za-z_$][\w$]*)/.exec(clause)?.[1] as string]
        : []),
      ...(/\{([^}]*)\}/.exec(clause)?.[1] ?? "")
        .split(",")
        .map(
          (n) =>
            n
              .trim()
              .replace(/^type\s+/, "")
              .split(/\s+as\s+/)[0]
              ?.trim() ?? "",
        )
        .filter(Boolean),
    ];
    const unknown = wanted.filter((n) => !names.includes(n));
    if (unknown.length) return `${unknown.join(", ")} not exported by ${from}`;
  }
  return null;
}

export interface ModelConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
  reasoningEffort?: string;
}

/** Drafts with the open model (validation retry with the error fed back), then checks. */
export async function documentComponent(
  componentsDir: string,
  id: string,
  model: ModelConfig,
  at = new Date().toISOString().slice(0, 10),
): Promise<{ ok: boolean; dropped: string[]; error?: string }> {
  const facts = await componentFacts(componentsDir, id);
  const client = new OpenAI({
    baseURL: model.baseURL,
    apiKey: model.apiKey ?? "local",
    timeout: 120_000,
  });
  const schema = z.toJSONSchema(draftSchema, { target: "draft-7" }) as Record<string, unknown>;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `${draftPrompt(facts)}\n\nAnswer with one compact JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`,
    },
  ];
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await client.chat.completions.create({
      model: model.model,
      temperature: 0.2,
      frequency_penalty: 0.3,
      max_tokens: 3000,
      messages,
      // Plain JSON mode: grammar-constrained decoding let this model pad strings with endless whitespace.
      response_format: { type: "json_object" },
      ...(model.reasoningEffort
        ? { reasoning_effort: model.reasoningEffort as OpenAI.ReasoningEffort }
        : {}),
    });
    const content = res.choices[0]?.message.content ?? "";
    if (process.env.DOCUMENT_DEBUG)
      console.error(id, attempt, res.choices[0]?.finish_reason, content.length);
    try {
      const draft = draftSchema.parse(boundDraft(JSON.parse(content)));
      const { docs, dropped } = checkDraft(facts, draft, { by: model.model, at });
      const valid = componentDocsSchema.safeParse(docs);
      if (!valid.success) {
        last = `${valid.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}${dropped.length ? ` (dropped: ${dropped.join("; ")})` : ""}`;
        messages.push(
          { role: "assistant", content },
          {
            role: "user",
            content: `After checking against the facts these sections are invalid or empty: ${last}. Dropped: ${dropped.join("; ") || "none"}. Use only names from symbols and exact titles from tests. Return the corrected JSON.`,
          },
        );
        continue;
      }
      writeFileSync(
        join(componentsDir, id, "guide.yaml"),
        `# Component guide (turbineh.guide/v0.1). Generated by the intake documentation step: facts from the code, narrative
# drafted by ${model.model} and checked by code (see generated). Hand edits welcome; keep every claim true.
${stringify(valid.data, { lineWidth: 110 })}`,
      );
      return { ok: true, dropped };
    } catch (err) {
      last = err instanceof Error ? err.message.slice(0, 300) : String(err);
      messages.push(
        { role: "assistant", content },
        { role: "user", content: `Invalid: ${last}. Return JSON only.` },
      );
    }
  }
  return { ok: false, dropped: [], error: last };
}
