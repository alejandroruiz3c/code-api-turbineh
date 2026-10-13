import { existsSync, readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { major } from "./stack.js";
import {
  aliasFor,
  analysisFindings,
  namespaceDir,
  type AnalysisFindings,
  type RepoAnalysis,
} from "./repo-analysis.js";
import { readZip } from "./zip.js";

/**
 * Adaptation of a capability package to a client's project (PLAN §16 P5, ADR-0032). Deterministic: placement,
 * import rewriting, foundation modules, dependency merge (exact versions, never a downgrade), settings and the
 * database wiring are code. Only glue that cannot be derived (e.g. reusing a database client exported in an unusual
 * way) is requested from the adaptation model, with a deterministic fallback. Unrelated files are never touched:
 * every change is listed with its reason, and existing files are only modified where the integration requires it
 * (package.json, .env.example, the Drizzle schema entry point).
 */

export const GENERATED_HEADER = "// turbineh:generated";

/**
 * Foundation modules and verified versions from TurbineH's base template (catalog/recipes/saas-crud/template): the
 * Security Pack basics components import (`@/security/errors`, `@/security/rate-limit`…) and the exact versions of
 * the libraries they use. Only modules a package actually imports are copied into a client's project.
 */
export function loadFoundation(templateDir: string): {
  foundation: Record<string, string>;
  versions: Record<string, string>;
} {
  const foundation: Record<string, string> = {};
  const src = posix.join(templateDir, "src");
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = posix.join(dir, e.name);
      const r = posix.relative(src, p);
      if (e.isDirectory()) {
        if (!/^(app|db|entities|components)$/.test(r)) walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name))
        foundation[r.replace(/\.(ts|tsx)$/, "")] = readFileSync(p, "utf8");
    }
  };
  if (existsSync(src)) walk(src);
  const pkg = JSON.parse(readFileSync(posix.join(templateDir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return { foundation, versions: { ...pkg.devDependencies, ...pkg.dependencies } };
}

export interface AdaptedFile {
  path: string;
  content: string | Buffer;
  action: "add" | "modify";
  why: string;
}

export type StepKey =
  "code" | "glue" | "database" | "dependencies" | "settings" | "lockfile" | "migration";

export interface CommitStep {
  key: StepKey;
  message: string;
  files: AdaptedFile[];
}

/** Glue the adaptation model writes (the fallback is used when the model is unavailable or its output fails). */
export interface GlueRequest {
  path: string;
  purpose: string;
  instructions: string;
  context: Record<string, string>;
  /** The output must match this to be accepted (e.g. it must export `db`). */
  mustMatch: string;
  fallback: string;
  fallbackWhy: string;
  /** Dependencies only the fallback needs (added to package.json only if the fallback is used). */
  fallbackDependencies: { name: string; version: string; dev: boolean }[];
}

export interface Adaptation {
  slug: string;
  namespace: string;
  kind: "use_case" | "component";
  steps: CommitStep[];
  findings: AnalysisFindings;
  decisions: { topic: string; choice: string; why: string }[];
  reviewerSetup: string[];
  limits: string[];
  dependencies: { added: string[]; kept: string[]; conflicts: string[] };
  settings: string[];
  migration: {
    kind: "drizzle-kit" | "sql" | "none";
    /** App-relative directory where the generated migration lands. */
    dir: string | null;
    /** drizzle-kit config used to generate it (app-relative), or the TurbineH one. */
    config: string | null;
    schemaFile: string | null;
  };
  /** Tests of the capability, as paths relative to the app, and whether the project's own runner picks them up. */
  tests: { files: string[]; runInProjectSuite: boolean };
  glue: GlueRequest[];
}

export interface AdaptInput {
  zip: Buffer;
  analysis: RepoAnalysis;
  /** Reads a file of the client's repository (repository-relative path); null when absent. */
  read: (path: string) => string | null;
  /** TurbineH foundation modules (Security Pack basics), by module path without extension: "security/errors". */
  foundation: Record<string, string>;
  /** Exact versions known to work with the package (its verified template), for imports it needs. */
  versions: Record<string, string>;
  planId: string;
  need: string;
}

interface Manifest {
  slug: string;
  name?: string;
  dependencies?: Record<string, string>;
  environment?: string[];
  entryPoints?: string[];
  components?: { id: string }[];
}

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs)$/;
const NODE_BUILTIN =
  /^(node:|(assert|buffer|child_process|crypto|events|fs|http|https|net|os|path|stream|url|util|zlib|worker_threads|timers|querystring|readline|dns|tls|perf_hooks|async_hooks)(\/|$))/;
/** Packages only tests or types need: they go to devDependencies. */
const DEV_ONLY = /^(vitest|@vitest\/|@types\/|@playwright\/test$|tsx$|drizzle-kit$)/;

const rel = (from: string, to: string) => {
  const r = posix.relative(posix.dirname(from), to).replace(/\.(ts|tsx|mts|js|jsx|mjs)$/, "");
  return r.startsWith(".") ? r : `./${r}`;
};
const pkgName = (spec: string) =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] ?? spec);
const exact = (v: string) => /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(v)?.[1] ?? v;
const at = (a: RepoAnalysis, p: string) => (a.appPath ? `${a.appPath}/${p}` : p);

const IMPORT_RE =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.mock\s*\(\s*)(["'])([^"'\n]+)\2/g;

/** Every module specifier of a source file (imports, re-exports, dynamic imports, require, vi.mock). */
export function importsOf(code: string): string[] {
  return [...code.matchAll(IMPORT_RE)].map((m) => m[3] ?? "");
}

export function rewriteImports(code: string, map: (spec: string) => string | null): string {
  return code.replace(IMPORT_RE, (all, lead: string, q: string, spec: string) => {
    const next = map(spec);
    return next === null ? all : `${lead}${q}${next}${q}`;
  });
}

/** Adds dependencies the project lacks (exact versions). Existing entries are never changed (no downgrades). */
export function mergePackageJson(
  text: string,
  add: { name: string; version: string; dev: boolean }[],
): { text: string; added: string[]; kept: string[] } {
  const pkg = JSON.parse(text) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const indent = /^\{\n(\s+)"/.exec(text)?.[1] ?? "  ";
  const have = { ...pkg.dependencies, ...pkg.devDependencies };
  const added: string[] = [];
  const kept: string[] = [];
  for (const d of add) {
    if (d.name in have) {
      kept.push(d.name);
      continue;
    }
    const field = d.dev ? "devDependencies" : "dependencies";
    const current = pkg[field] ?? {};
    const keys = Object.keys(current);
    const sorted = keys.every((k, i) => i === 0 || (keys[i - 1] ?? "") <= k);
    const next = { ...current, [d.name]: exact(d.version) };
    pkg[field] = sorted
      ? Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)))
      : next;
    have[d.name] = d.version;
    added.push(`${d.name}@${exact(d.version)}${d.dev ? " (dev)" : ""}`);
  }
  if (!added.length) return { text, added, kept };
  return { text: `${JSON.stringify(pkg, null, indent)}\n`, added, kept };
}

export interface SettingDoc {
  comment: string[];
  value: string;
}

/** Comments and example values of a package's .env.example, by setting name. */
export function envDocs(text: string): Record<string, SettingDoc> {
  const out: Record<string, SettingDoc> = {};
  // A comment block documents every setting that follows it, up to a blank line or the next comment.
  let comment: string[] = [];
  let afterKey = false;
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (l.startsWith("#")) {
      if (afterKey) comment = [];
      afterKey = false;
      comment.push(l.replace(/^#+\s?/, ""));
    } else if (!l) {
      comment = [];
      afterKey = false;
    } else {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(l);
      if (m?.[1]) out[m[1]] = { comment: [...comment], value: (m[2] ?? "").trim() };
      afterKey = true;
    }
  }
  return out;
}

/** required = no default and a credential or connection; default = the package documents a value; else optional. */
export function settingKind(name: string, doc?: SettingDoc): "required" | "default" | "optional" {
  if (doc?.value) return "default";
  if (/(TOKEN|SECRET|PASSWORD|_KEY|DATABASE_URL)$/.test(name)) return "required";
  return doc && /optional|default|empty\s*=/i.test(doc.comment.join(" ")) ? "optional" : "required";
}

/**
 * Adds the settings the project's .env.example lacks: names and the package's explanatory comments, never values
 * (a documented non-secret default is mentioned in the comment).
 */
export function mergeEnvExample(
  current: string,
  keys: string[],
  header: string,
  docs: Record<string, SettingDoc> = {},
): { text: string; added: string[] } {
  const have = new Set(
    current.split("\n").map((l) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1]),
  );
  const added = [...new Set(keys)].filter((k) => !have.has(k));
  if (!added.length) return { text: current, added };
  const sep = current === "" || current.endsWith("\n") ? "" : "\n";
  const gap = current.trim() ? "\n" : "";
  return {
    text: `${current}${sep}${gap}# ${header}\n${added
      .map((k) => {
        const d = docs[k];
        const notes = [
          ...(d?.comment ?? []).filter((c) => !/^[A-Z][A-Z0-9_]*=/.test(c)).slice(0, 3),
          ...(d?.value &&
          settingKind(k, d) === "default" &&
          !/(TOKEN|SECRET|PASSWORD|_KEY)$/.test(k)
            ? [`default: ${d.value}`]
            : []),
        ];
        return `${notes.map((n) => `# ${n}`).join("\n")}${notes.length ? "\n" : ""}${k}=`;
      })
      .join("\n")}\n`,
    added,
  };
}

/** `export const <name> = drizzle(` / `export const db` in a client module → the exported name. */
export function drizzleExport(source: string): string | null {
  const direct = /export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*drizzle\s*[(<]/.exec(source)?.[1];
  if (direct) return direct;
  if (/export\s+(const|let|var)\s+db\b/.test(source)) return "db";
  const named = /export\s*\{([^}]*)\}/.exec(source)?.[1];
  const db = named
    ?.split(",")
    .map((s) => s.trim())
    .find((s) => /(^db$|\bas\s+db$)/.test(s));
  return db ? "db" : null;
}

/** Whether a Drizzle `schema` setting is one file that can re-export the capability's tables. */
const singleSchemaFile = (schema: string | null) =>
  schema && /\.(ts|js|mts)$/.test(schema) && !/[*{]/.test(schema) ? schema : null;

export function adaptPackage(input: AdaptInput): Adaptation {
  const a = input.analysis;
  const entries = readZip(input.zip);
  const top = entries[0]?.path.split("/")[0] ?? "";
  const files = new Map<string, Buffer>();
  for (const e of entries) {
    const r = e.path.split("/").slice(1).join("/");
    if (!r || r.includes("..")) continue;
    files.set(r, e.data);
  }
  const manifestText = files.get("manifest.json")?.toString("utf8");
  if (!manifestText) throw new Error(`package ${top} has no manifest.json`);
  const manifest = JSON.parse(manifestText) as Manifest;
  const slug = manifest.slug;
  const ns = namespaceDir(a, slug);
  const kind: Adaptation["kind"] = [...files.keys()].some((p) => p.startsWith("examples/app/"))
    ? "use_case"
    : "component";
  const jest = a.tests.runner === "jest";
  const limits: string[] = [];
  const reviewerSetup: string[] = [];
  const appDir = a.framework.appDir ?? (a.sourceRoot ? "src/app" : "app");

  // ── 1. placement: package path → repository path ───────────────────────────────────────────────────────
  const target = new Map<string, string>();
  const skipped: string[] = [];
  for (const p of files.keys()) {
    if (p.startsWith("examples/app/") || /^(vitest|playwright)\.config\.\w+$/.test(p)) continue;
    if (p.startsWith("src/app/")) {
      const route = p.slice("src/app/".length);
      // Root layout, home page and global styles belong to the client's app.
      if (/^(layout|page|globals?)\.(tsx|ts|css)$/.test(route) || /^(favicon|icon)\./.test(route)) {
        skipped.push(p);
        continue;
      }
      const dest = at(a, `${appDir}/${route}`);
      if (input.read(dest) !== null) {
        limits.push(
          `\`${dest}\` already exists in your project and was kept; the capability's version is in the ZIP (src/app/${route}).`,
        );
        skipped.push(p);
        continue;
      }
      target.set(p, dest);
    } else if (p.startsWith("src/")) target.set(p, `${ns}/${p.slice(4)}`);
    else if (p.startsWith("tests/"))
      target.set(p, `${ns}/${jest ? p.replace(/\.test\.(ts|tsx)$/, ".vitest.$1") : p}`);
    else target.set(p, `${ns}/${p}`);
  }

  // ── 2. imports: package-internal → relative; foundation modules copied; db glue generated ─────────────
  const pkgModule = (spec: string): string | null => {
    const base = `src/${spec}`;
    for (const c of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ])
      if (target.has(c) || skipped.includes(c)) return c;
    return null;
  };
  const extra = new Map<
    string,
    { content: string; why: string; step: StepKey; deferDeps?: boolean }
  >();
  const unresolved = new Set<string>();
  const bare = new Map<string, Set<string>>();
  const dbTables = [...files.keys()].filter(
    (p) => /^src\/db\/[^/]+\.ts$/.test(p) && !/^src\/db\/(client|schema|index)\.ts$/.test(p),
  );
  const usesDb =
    dbTables.length > 0 ||
    [...files.entries()].some(
      ([p, d]) => CODE.test(p) && importsOf(d.toString("utf8")).includes("@/db/client"),
    );
  const usesAuth = [...files.entries()].some(
    ([p, d]) =>
      CODE.test(p) &&
      importsOf(d.toString("utf8")).some((s) => s === "@/lib/auth" || s === "better-auth"),
  );
  const findings = analysisFindings(a, {
    kind,
    slug,
    usesDatabase: usesDb,
    usesAuth,
    dependencies: manifest.dependencies ?? {},
  });
  const decisions = [...findings.decisions];
  const glue: GlueRequest[] = [];

  const ownDbClient = `${GENERATED_HEADER} — database client of this capability (TurbineH adaptation)
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

/** Uses the project's DATABASE_URL; the pool connects lazily on the first query. */
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
export const db = drizzle(pool, { schema });
`;
  const ensureFoundation = (spec: string, from: string): string | null => {
    const mod = spec.slice(2);
    const dest = `${ns}/${mod}.ts`;
    if (extra.has(dest)) return rel(from, dest);
    if (mod === "db/schema") {
      const exports = dbTables
        .map((p) => `export * from "${rel(dest, target.get(p) ?? "")}";`)
        .join("\n");
      extra.set(dest, {
        content: `${GENERATED_HEADER} — tables of this capability (TurbineH adaptation)\n${exports || "export {};"}\n`,
        why: "Entry point of the capability's tables",
        step: "code",
      });
      return rel(from, dest);
    }
    if (mod === "db/client") {
      const clientMod = a.orm.library === "drizzle" ? a.orm.clientModule : null;
      const src = clientMod ? input.read(at(a, clientMod)) : null;
      const name = src ? drizzleExport(src) : null;
      if (clientMod && src && name && (a.database === "postgres" || a.database === null)) {
        const alias = aliasFor(a, a.sourceRoot);
        const clientPath = at(a, clientMod);
        const inSource = a.sourceRoot ? clientMod.startsWith(`${a.sourceRoot}/`) : true;
        const spec2 =
          alias && inSource
            ? `${alias}${clientMod
                .slice(a.sourceRoot ? a.sourceRoot.length + 1 : 0)
                .replace(/\.(ts|js|mts)$/, "")
                .replace(/\/index$/, "")}`
            : rel(dest, clientPath);
        extra.set(dest, {
          content: `${GENERATED_HEADER} — the capability uses your database client (${clientMod})\nexport { ${name === "db" ? "db" : `${name} as db`} } from "${spec2}";\n`,
          why: `Reuses your Drizzle client from \`${clientMod}\` (no second connection pool)`,
          step: "glue",
        });
      } else if (clientMod && src && a.database !== "mysql" && a.database !== "sqlite") {
        glue.push({
          path: dest,
          purpose: "reuse the project's Drizzle database client",
          instructions: `Write a TypeScript module that exports \`db\`: the project's existing Drizzle PostgreSQL client from ${clientMod}. Import it with the specifier "${rel(dest, at(a, clientMod))}". If the module exports a factory (e.g. getDb()), call it once at module level. Do not create a new connection. Only the code, first line exactly "${GENERATED_HEADER}".`,
          context: { [clientMod]: src.slice(0, 6000) },
          mustMatch: "export\\s+(const|\\{[^}]*\\bdb\\b)",
          fallback: ownDbClient,
          fallbackWhy:
            "Own Drizzle client on DATABASE_URL (your client's export could not be adapted)",
          fallbackDependencies: (
            [
              ["drizzle-orm", false],
              ["pg", false],
              ["@types/pg", true],
            ] as const
          )
            .filter(([n]) => input.versions[n])
            .map(([n, dev]) => ({ name: n, version: input.versions[n] ?? "", dev })),
        });
        extra.set(dest, {
          content: ownDbClient,
          why: "Database client of the capability",
          step: "glue",
          deferDeps: true,
        });
        ensureFoundation("@/db/schema", dest);
      } else {
        extra.set(dest, {
          content: ownDbClient,
          why: "Database client of the capability on your DATABASE_URL",
          step: "glue",
        });
        ensureFoundation("@/db/schema", dest);
      }
      return rel(from, dest);
    }
    const found = input.foundation[mod];
    if (found === undefined) return null;
    const entry = {
      content: found,
      why: "Security Pack basics the capability relies on",
      step: "code" as StepKey,
    };
    extra.set(dest, entry);
    // Foundation modules can import other foundation modules.
    entry.content = rewriteImports(found, (s) =>
      s.startsWith("@/") ? ensureFoundation(s, dest) : null,
    );
    return rel(from, dest);
  };

  const out = new Map<string, AdaptedFile & { step: StepKey }>();
  let usesNode = false;
  const transform = (srcPath: string, dest: string, code: string): string => {
    const rewritten = rewriteImports(code, (spec) => {
      if (spec.startsWith("@/")) {
        const own = pkgModule(spec.slice(2));
        if (own) {
          const t = target.get(own);
          if (t) return rel(dest, t);
          unresolved.add(`${spec} (from ${srcPath}: the module was not integrated)`);
          return null;
        }
        const f = ensureFoundation(spec, dest);
        if (f) return f;
        unresolved.add(`${spec} (from ${srcPath})`);
        return null;
      }
      if (NODE_BUILTIN.test(spec)) usesNode = true;
      else if (!spec.startsWith(".")) {
        const n = pkgName(spec);
        if (!bare.has(n)) bare.set(n, new Set());
        bare.get(n)?.add(srcPath);
      }
      return null;
    });
    return rewritten;
  };
  for (const [p, dest] of target) {
    const data = files.get(p) ?? Buffer.alloc(0);
    const isCode = CODE.test(p);
    out.set(dest, {
      path: dest,
      content: isCode ? transform(p, dest, data.toString("utf8")) : data,
      action: "add",
      why: p.startsWith("src/app/")
        ? "Route of the capability (App Router)"
        : p.startsWith("tests/")
          ? "Tests of the capability"
          : p.startsWith("src/")
            ? "Capability code"
            : "Capability documentation, manifest and licences",
      step: "code",
    });
  }
  // Foundation and glue files can themselves import packages.
  for (const [dest, f] of extra) {
    if (out.has(dest)) continue;
    if (!f.deferDeps)
      for (const s of importsOf(f.content))
        if (NODE_BUILTIN.test(s)) usesNode = true;
        else if (!s.startsWith(".") && !s.startsWith("@/")) {
          const n = pkgName(s);
          if (!bare.has(n)) bare.set(n, new Set());
          bare.get(n)?.add(dest);
        }
    out.set(dest, { path: dest, content: f.content, action: "add", why: f.why, step: f.step });
  }
  for (const u of unresolved)
    limits.push(
      `Import ${u} has no counterpart in your project yet: wire it by hand (agent/INTEGRATE.md).`,
    );

  // ── 3. dependencies ────────────────────────────────────────────────────────────────────────────────────
  const pkgPath = at(a, "package.json");
  const pkgText = input.read(pkgPath);
  const wanted: { name: string; version: string; dev: boolean }[] = [];
  const missingVersion: string[] = [];
  const declared = manifest.dependencies ?? {};
  const testOnly = (n: string) =>
    [...(bare.get(n) ?? [])].every((p) => p.startsWith("tests/") || /\.(test|spec)\./.test(p));
  for (const n of [...bare.keys()].sort()) {
    const version = declared[n] ?? input.versions[n];
    if (!version) {
      missingVersion.push(n);
      continue;
    }
    wanted.push({ name: n, version, dev: DEV_ONLY.test(n) || testOnly(n) });
  }
  if (a.language === "typescript" && [...out.keys()].some((p) => CODE.test(p))) {
    if (usesDb && input.versions["@types/pg"] && bare.has("pg"))
      wanted.push({ name: "@types/pg", version: input.versions["@types/pg"], dev: true });
    if (usesNode && input.versions["@types/node"])
      wanted.push({ name: "@types/node", version: input.versions["@types/node"], dev: true });
  }
  for (const m of missingVersion)
    limits.push(`No verified version known for \`${m}\`: add it with your package manager.`);
  const conflicts: string[] = [];
  const projectDeps = (() => {
    try {
      const j = JSON.parse(pkgText ?? "{}") as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return { ...j.devDependencies, ...j.dependencies };
    } catch {
      return {};
    }
  })();
  for (const w of wanted) {
    const have = projectDeps[w.name];
    if (have && Number.isFinite(major(have)) && major(have) !== major(w.version))
      conflicts.push(
        `${w.name}: the capability is verified with ${exact(w.version)}; your ${have} is kept (never downgraded or changed).`,
      );
  }
  const merged = pkgText ? mergePackageJson(pkgText, wanted) : { text: "", added: [], kept: [] };
  if (merged.added.length)
    out.set(pkgPath, {
      path: pkgPath,
      content: merged.text,
      action: "modify",
      why: `Adds ${merged.added.length} dependenc${merged.added.length === 1 ? "y" : "ies"} with exact versions (existing ones unchanged)`,
      step: "dependencies",
    });
  if (wanted.some((w) => w.name === "vitest") && !("vitest" in projectDeps))
    decisions.push({
      topic: "tests",
      choice: "vitest added as a dev dependency",
      why: "The capability's tests import vitest; without it your type check would fail on them.",
    });

  // ── 4. settings ────────────────────────────────────────────────────────────────────────────────────────
  const envKeys = [...(manifest.environment ?? [])];
  const dbClient = out.get(`${ns}/db/client.ts`);
  const ownClient =
    dbClient &&
    typeof dbClient.content === "string" &&
    dbClient.content.includes("process.env.DATABASE_URL");
  if (ownClient || glue.length) envKeys.unshift("DATABASE_URL");
  const envPath = a.envExample ?? at(a, ".env.example");
  const envNow = input.read(envPath);
  const settingDocs = envDocs(files.get("config/.env.example")?.toString("utf8") ?? "");
  if (!settingDocs.DATABASE_URL)
    settingDocs.DATABASE_URL = { comment: ["PostgreSQL connection string"], value: "" };
  const env = mergeEnvExample(
    envNow ?? "",
    envKeys,
    `${manifest.name ?? slug} (TurbineH capability) — see ${ns}/config/.env.example`,
    settingDocs,
  );
  if (env.added.length)
    out.set(envPath, {
      path: envPath,
      content: env.text,
      action: envNow === null ? "add" : "modify",
      why: `Documents ${env.added.length} setting${env.added.length === 1 ? "" : "s"} by name (no values, no secrets)`,
      step: "settings",
    });

  // ── 5. database: the client's migration system ─────────────────────────────────────────────────────────
  let migration: Adaptation["migration"] = {
    kind: "none",
    dir: null,
    config: null,
    schemaFile: null,
  };
  const schemaEntry = `${ns}/db/schema.ts`;
  if (dbTables.length && (out.has(schemaEntry) || extra.has(schemaEntry))) {
    const single = a.orm.library === "drizzle" ? singleSchemaFile(a.orm.schema) : null;
    const schemaPath = single ? at(a, posix.normalize(single)) : null;
    const schemaText = schemaPath ? input.read(schemaPath) : null;
    if (a.orm.library === "drizzle" && schemaPath && schemaText !== null && a.orm.config) {
      const line = `export * from "${rel(schemaPath, schemaEntry)}";`;
      if (!schemaText.includes(line))
        out.set(schemaPath, {
          path: schemaPath,
          content: `${schemaText}${schemaText.endsWith("\n") || !schemaText ? "" : "\n"}${line} // turbineh: ${slug} tables\n`,
          action: "modify",
          why: "Adds the capability's tables to your Drizzle schema (one line)",
          step: "database",
        });
      migration = {
        kind: "drizzle-kit",
        dir: a.orm.migrationsDir,
        config: a.orm.config,
        schemaFile: single,
      };
      const scripts = (() => {
        try {
          return (
            (
              JSON.parse(input.read(at(a, "package.json")) ?? "{}") as {
                scripts?: Record<string, string>;
              }
            ).scripts ?? {}
          );
        } catch {
          return {};
        }
      })();
      const migrateScript = Object.entries(scripts).find(([, cmd]) =>
        /drizzle-kit\s+(migrate|push)/.test(cmd),
      )?.[0];
      const pmRun =
        a.packageManager.name === "npm" || !a.packageManager.name
          ? "npm run"
          : a.packageManager.name;
      reviewerSetup.push(
        `Apply the new migration (\`${a.orm.migrationsDir ?? "drizzle"}/\`) in each environment before deploying: \`${migrateScript ? `${pmRun} ${migrateScript}` : "npx drizzle-kit migrate"}\`.`,
      );
    } else {
      const dir = `${ns.slice(a.appPath ? a.appPath.length + 1 : 0)}/db/migrations`;
      migration = { kind: "sql", dir, config: null, schemaFile: null };
      if (a.orm.library === "drizzle")
        limits.push(
          `Your drizzle.config \`schema\` is not a single file, so the capability's tables are not in your drizzle-kit schema: add \`${schemaEntry}\` to it to manage them with drizzle-kit.`,
        );
      reviewerSetup.push(
        `Apply \`${at(a, dir)}/*.sql\` to your database (${a.orm.library === "prisma" ? "Prisma does not manage these tables: add them to your migration history or apply them with psql" : `e.g. \`psql "$DATABASE_URL" -f ${at(a, dir)}/<file>.sql\``}).`,
      );
    }
  }

  // ── 6. what the reviewer configures; limits ────────────────────────────────────────────────────────────
  if (merged.added.length)
    reviewerSetup.unshift(
      `After merging, run \`${a.packageManager.name ?? "npm"} install\`${a.packageManager.lockfile ? ` (this pull request already updates \`${a.packageManager.lockfile}\`)` : ""}.`,
    );
  // Only settings the project does not have yet; required ones first, optional ones keep their defaults.
  const required = env.added.filter((k) => settingKind(k, settingDocs[k]) === "required");
  const optional = env.added.filter((k) => settingKind(k, settingDocs[k]) !== "required");
  if (required.length)
    reviewerSetup.push(
      `Set ${required.length === 1 ? "this setting" : "these settings"} in each environment (documented in \`${envPath}\`): ${required
        .map(
          (k) => `\`${k}\`${settingDocs[k]?.comment[0] ? ` — ${settingDocs[k]?.comment[0]}` : ""}`,
        )
        .join("; ")}.`,
    );
  if (optional.length)
    reviewerSetup.push(
      `Optional, nothing to do unless you want to change the defaults: ${optional.map((k) => `\`${k}\``).join(", ")}.`,
    );
  const entryFiles = (manifest.entryPoints ?? [])
    .map((e) => (e.startsWith("src/") ? `${ns}/${e.slice(4)}` : null))
    .filter((e): e is string => Boolean(e && [...out.keys()].includes(e)));
  reviewerSetup.push(
    entryFiles.length
      ? `Call the capability where your app needs it: ${entryFiles.map((e) => `\`${e}\``).join(", ")} (usage and examples in \`${ns}/agent/INTEGRATE.md\`).`
      : `Call the capability where your app needs it (usage and examples in \`${ns}/agent/INTEGRATE.md\`).`,
  );
  if (kind === "use_case")
    limits.push(
      "Complete flows bring their own pages; navigation links, branding and access rules in your app are left for you to decide.",
    );
  if (skipped.length)
    limits.push(
      `${skipped.length} file(s) of the package were not placed in your project (your root layout, home page, styles or an existing route): they are in the ZIP.`,
    );

  // ── 7. commit steps (one per logical change) ───────────────────────────────────────────────────────────
  const stepOf = (k: StepKey) => [...out.values()].filter((f) => f.step === k);
  const steps: CommitStep[] = (
    [
      ["code", `feat(turbineh): add ${slug} capability (code, tests, docs)`],
      ["glue", `feat(turbineh): connect ${slug} to the project's database`],
      ["database", `feat(turbineh): register ${slug} tables in the Drizzle schema`],
      ["dependencies", `chore(turbineh): add dependencies of ${slug} (exact versions)`],
      ["settings", `docs(turbineh): document ${slug} settings in ${posix.basename(envPath)}`],
    ] as [StepKey, string][]
  )
    .map(([key, message]) => ({
      key,
      message,
      files: stepOf(key).map(({ step: _s, ...f }) => f),
    }))
    .filter((s) => s.files.length > 0);

  const testFiles = [...out.keys()]
    .filter((p) => p.startsWith(`${ns}/tests/`) && /\.(test|vitest)\.(ts|tsx)$/.test(p))
    .map((p) => (a.appPath ? p.slice(a.appPath.length + 1) : p));
  return {
    slug,
    namespace: ns,
    kind,
    steps,
    findings: { ...findings, conflicts: [...findings.conflicts, ...conflicts] },
    decisions,
    reviewerSetup,
    limits,
    dependencies: { added: merged.added, kept: merged.kept, conflicts },
    settings: env.added,
    migration,
    tests: { files: testFiles, runInProjectSuite: a.tests.runner === "vitest" },
    glue,
  };
}
