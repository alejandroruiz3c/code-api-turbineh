import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { componentDocsSchema, DOCS_SCHEMA, type ComponentDocs } from "@turbineh/catalog";
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

export interface ComponentFacts {
  id: string;
  manifest: Manifest;
  pkg: { name: string; version: string };
  /** Names the code really exposes or uses from the package (imports in tests/glue, exports of glue/files). */
  symbols: string[];
  /** Import specifier → names importable from it (the package itself, the curated glue, native files). */
  importable: Record<string, string[]>;
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

/** Names imported from `pkg` (default, named, namespace). */
export function importsFrom(src: string, pkg: string): string[] {
  const own = new Set(symbolsOf(src, pkg));
  for (const e of exportsOf(src)) own.delete(e.name);
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
): { files: { abs: string; spec: string }[]; tests: { abs: string; rel: string }[] } {
  const recipes = join(componentsDir, "../recipes");
  if (!existsSync(recipes)) return { files: [], tests: [] };
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
      const imports = [...src.matchAll(/from\s+["'](@\/[^"']+)["']/g)].map((m) => m[1] as string);
      if (imports.some((i) => specs.has(i)) && !tests.some((x) => x.rel.endsWith(relative(t, f))))
        tests.push({ abs: f, rel: `recipe template ${relative(join(t, ".."), f)}` });
    }
  }
  return { files, tests };
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
  const kinds: ComponentFacts["kinds"] = {};
  if (!pkg.name.startsWith("turbineh/")) {
    importable[pkg.name] = importsFrom(all, pkg.name);
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
    manifest,
    pkg,
    symbols,
    importable,
    kinds,
    env,
    tests: [
      ...testsOf(dir),
      ...vendored.tests.flatMap((t) =>
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
  use_cases: z.array(S).min(2).max(6),
  when_to_use: z.array(S).min(1).max(4),
  when_not_to_use: z
    .array(z.object({ instead: S, why: S }))
    .min(1)
    .max(4),
  tradeoffs: z.array(S).min(1).max(4),
  interfaces: z
    .array(
      z.object({
        name: S,
        kind: z.enum(["export", "route", "component", "hook", "type", "cli"]),
        about: S,
      }),
    )
    .min(1)
    .max(8),
  extension_points: z.array(S).max(4),
  security: z.array(S).min(1).max(4),
  guarantees: z
    .array(z.object({ claim: S, test_title: S }))
    .min(1)
    .max(6),
  limits: z.array(S).min(1).max(4),
  example: z.string().max(1200),
  keywords: z.array(z.string().max(40)).min(5).max(20),
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
    if (!symbols.has(name)) {
      dropped.push(`interface ${i.name} (not in the code)`);
      return [];
    }
    return [{ name, kind: f.kinds[name] ?? "export", about: i.about.trim().slice(0, 400) }];
  });
  const guarantees = d.guarantees.flatMap((g) => {
    const t = f.tests.find((x) => x.title === g.test_title.trim());
    if (!t) {
      dropped.push(`guarantee "${g.claim}" (no test titled "${g.test_title}")`);
      return [];
    }
    return [{ claim: g.claim.slice(0, 400), test: { file: t.file, title: t.title } }];
  });
  const whenNot = d.when_not_to_use.filter((w) => {
    const looksLikeId = /^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$/.test(w.instead.trim());
    if (looksLikeId && !f.catalogIds.includes(w.instead.trim())) {
      dropped.push(`alternative ${w.instead} (not in the catalog)`);
      return false;
    }
    return true;
  });
  const exampleIssue = exampleProblem(d.example, f.importable);
  const example = exampleIssue ? "" : d.example.trim().split("\n").slice(0, 30).join("\n");
  if (exampleIssue) dropped.push(`example (${exampleIssue})`);
  const m = f.manifest;
  const security = [
    `Licence ${m.license.detected}${m.security?.scanned_at ? `; ${m.security.findings?.length ?? 0} known advisories (OSV) on ${m.security.scanned_at}` : ""}.`,
    `Effects: network ${m.effects?.network ? "yes" : "no"}, filesystem ${m.effects?.fs ? "yes" : "no"}, database ${m.effects?.db ? "yes" : "no"}${m.effects?.external_services?.length ? `; external services: ${m.effects.external_services.join(", ")}` : ""}.`,
    ...clean(d.security),
  ];
  const docs: ComponentDocs = {
    schema: DOCS_SCHEMA,
    id: f.id,
    does: m.capability.does,
    ...(m.capability.does_not ? { does_not: m.capability.does_not } : {}),
    use_cases: clean(d.use_cases),
    when_to_use: clean(d.when_to_use),
    when_not_to_use: whenNot.map((w) => ({
      instead: w.instead.trim().slice(0, 120),
      why: w.why.trim().slice(0, 400),
    })),
    tradeoffs: clean(d.tradeoffs),
    inputs: [
      ...(m.integration?.install
        ? [
            {
              name: m.integration.install,
              kind: "install" as const,
              about: "Exact version, added by TurbineH.",
            },
          ]
        : []),
      ...f.env.map((e) => ({
        name: e,
        kind: "env" as const,
        about: "Read by the component's code.",
      })),
    ],
    interfaces,
    extension_points: clean(d.extension_points),
    dependencies: {
      package: f.pkg.name,
      version: f.pkg.version,
      ...(m.compat?.runtime ? { runtime: m.compat.runtime } : {}),
      peers: m.compat?.peer ?? {},
      requires: m.relations.requires,
      conflicts: m.relations.conflicts,
    },
    compatibility: [
      `${m.compat?.runtime ?? "node"}${
        Object.keys(m.compat?.peer ?? {}).length
          ? `; peers: ${Object.entries(m.compat?.peer ?? {})
              .map(([k, v]) => `${k}@${v}`)
              .join(", ")}`
          : ""
      }.`,
      "Verified with the TurbineH stack: Next.js (App Router), TypeScript strict, pnpm.",
    ],
    security,
    guarantees,
    limits: clean(d.limits),
    example,
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
    generated: {
      by: meta.by,
      at: meta.at,
      sections: [
        "use_cases",
        "when_to_use",
        "when_not_to_use",
        "tradeoffs",
        "interfaces",
        "extension_points",
        "security",
        "guarantees",
        "limits",
        "example",
        "keywords",
      ],
      checked: [
        "interfaces ⊂ code symbols",
        "guarantees → exact test titles",
        "alternatives ⊂ catalog",
        "example uses component symbols",
        "inputs, dependencies, compatibility, licence and effects from code/manifest",
      ],
    },
  };
  return { docs, dropped };
}

/** Why an example is not supported by the code (imports from unknown specifiers or of unknown names), or null. */
export function exampleProblem(
  example: string,
  importable: Record<string, string[]>,
): string | null {
  const imports = [...example.matchAll(/import\s+([^;]*?)\s+from\s+["']([^"']+)["']/g)];
  if (imports.length === 0) return "imports nothing from the component";
  for (const m of imports) {
    const from = m[2] as string;
    const names = importable[from];
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
        last = valid.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
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
        join(componentsDir, id, "docs.yaml"),
        `# Component documentation (turbineh.component-docs/v1). Narrative sections drafted by ${model.model} from the\n# code, tests and README, then checked by code (see generated.checked). Edit freely; keep facts true.\n${stringify(valid.data, { lineWidth: 110 })}`,
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
