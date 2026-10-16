import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { parse } from "yaml";
import type { RecipeModule } from "./recipes.js";

/**
 * Recipe tree-shaking (ADR-0064, audit F-05): optional parts of a template or a component ship only when a requirement
 * of the request asks for them. A module lists its files; shared files mark the module's lines between
 * `turbineh:module <id>` and `turbineh:end-module <id>` (any comment syntax, marker lines included), and lines that
 * replace them when the module is absent between `turbineh:without-module <id>` and `turbineh:end-without-module <id>`.
 * Removing a module deletes its files, its marked blocks, its settings in .env.example and its navigation entries.
 */
export interface TemplateModule extends RecipeModule {
  /** Who ships it: `recipe:<id>` or `component:<id>`. */
  owner: string;
  /**
   * Deterministic condition instead of a capability: "public-toolkit" keeps the module only when an installed domain
   * toolkit (src/<domain>/toolkit.ts) is meant for the public (`audience: "public"`).
   */
  when?: "public-toolkit";
}

export interface TreeShakeResult {
  removed: { module: string; owner: string; about: string; files: number; lines: number }[];
  /** Settings removed with their modules. */
  env: string[];
  /** Navigation hrefs removed with their modules. */
  nav: string[];
}

const TEXT = new Set([
  ".ts",
  ".tsx",
  ".mjs",
  ".js",
  ".css",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".example",
]);
const SKIP = new Set(["node_modules", ".git", ".next", "drizzle"]);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const lineCount = (file: string) => readFileSync(file, "utf8").split("\n").length;

/** Modules declared by a component manifest (component.yaml `modules`). */
export function componentModules(componentDir: string, id: string): TemplateModule[] {
  const file = join(componentDir, "component.yaml");
  if (!existsSync(file)) return [];
  const m = parse(readFileSync(file, "utf8")) as {
    modules?: (RecipeModule & { when?: "public-toolkit" })[];
  };
  return (m.modules ?? []).map((x) => ({ ...x, owner: `component:${id}` }));
}

/** True when an installed domain toolkit is meant for the public (the public assistant has something to offer). */
export function hasPublicToolkit(outDir: string): boolean {
  const src = join(outDir, "src");
  if (!existsSync(src)) return false;
  return readdirSync(src).some((d) => {
    const f = join(src, d, "toolkit.ts");
    return existsSync(f) && /audience:\s*"public"/.test(readFileSync(f, "utf8"));
  });
}

/** Removes or keeps the marked blocks of one module in a text. */
export function stripBlocks(text: string, id: string, kept: boolean): string {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mark = (k: string) => new RegExp(`turbineh:${k} ${esc}(?![\\w.-])`);
  const lines = text.split("\n");
  const out: string[] = [];
  let mode: "keep" | "drop" = "keep";
  for (const line of lines) {
    if (mark("module").test(line)) {
      mode = kept ? "keep" : "drop";
      continue;
    }
    if (mark("without-module").test(line)) {
      mode = kept ? "drop" : "keep";
      continue;
    }
    if (mark("end-module").test(line) || mark("end-without-module").test(line)) {
      mode = "keep";
      continue;
    }
    if (mode === "keep") out.push(line);
  }
  return out.join("\n");
}

/**
 * Removes the settings `names` from an .env.example text. A comment block goes with its settings when every setting
 * right below it is removed.
 */
export function dropEnv(text: string, names: readonly string[]): string {
  if (names.length === 0) return text;
  const out: string[] = [];
  let block: { comments: string[]; settings: string[] } = { comments: [], settings: [] };
  const flush = () => {
    const kept = block.settings.filter(
      (l) => !names.includes(/^([A-Z][A-Z0-9_]*)=/.exec(l.trim())?.[1] ?? ""),
    );
    if (kept.length > 0 || block.settings.length === 0) out.push(...block.comments);
    out.push(...kept);
    block = { comments: [], settings: [] };
  };
  for (const line of text.split("\n")) {
    const comment = line.trim().startsWith("#");
    if (comment && block.settings.length > 0) flush();
    if (comment) block.comments.push(line);
    else if (/^[A-Z][A-Z0-9_]*=/.test(line.trim())) block.settings.push(line);
    else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out.join("\n");
}

/**
 * Applies the modules to an assembled app: each module kept or removed (files, marked blocks, settings, navigation).
 * Every module's markers are processed either way, so no marker is left in a delivered file.
 */
export function treeShake(
  outDir: string,
  modules: readonly TemplateModule[],
  keep: (m: TemplateModule) => boolean,
): TreeShakeResult {
  const result: TreeShakeResult = { removed: [], env: [], nav: [] };
  if (modules.length === 0) return result;
  const decided = modules.map((m) => ({
    m,
    kept: m.when === "public-toolkit" ? hasPublicToolkit(outDir) : keep(m),
  }));
  for (const { m } of decided.filter((d) => !d.kept)) {
    let files = 0;
    let lines = 0;
    for (const rel of m.files) {
      const p = join(outDir, rel);
      if (!existsSync(p)) continue;
      const all = statSync(p).isDirectory() ? walk(p) : [p];
      for (const f of all) {
        files += 1;
        if (TEXT.has(extname(f))) lines += lineCount(f);
      }
      rmSync(p, { recursive: true, force: true });
    }
    result.removed.push({ module: m.id, owner: m.owner, about: m.about, files, lines });
    result.env.push(...(m.env ?? []));
    result.nav.push(...(m.nav ?? []));
  }
  for (const file of walk(outDir)) {
    if (!TEXT.has(extname(file)) && !file.endsWith(".env.example")) continue;
    const before = readFileSync(file, "utf8");
    if (!before.includes("turbineh:") || !/turbineh:(end-)?(without-)?module /.test(before))
      continue;
    let after = before;
    for (const { m, kept } of decided) after = stripBlocks(after, m.id, kept);
    if (after !== before) writeFileSync(file, after);
  }
  const example = join(outDir, ".env.example");
  if (result.env.length && existsSync(example))
    writeFileSync(example, dropEnv(readFileSync(example, "utf8"), result.env));
  return result;
}

/** Paths relative to the app of the files a module would remove (for tests and reports). */
export function moduleFiles(outDir: string, m: RecipeModule): string[] {
  return m.files.flatMap((rel) => {
    const p = join(outDir, rel);
    if (!existsSync(p)) return [];
    return statSync(p).isDirectory() ? walk(p).map((f) => relative(outDir, f)) : [rel];
  });
}
