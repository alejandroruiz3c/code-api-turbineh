import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { shippedDirs } from "./guide.js";

/**
 * Agent-ready admission checks (ADR-0032), run by `pnpm catalog:validate` on every recipe template and every native
 * component's files. Only what can be checked mechanically; the rest of the standard is in docs/CATALOG.md.
 */

/** Fixed palette utilities that bypass the theme tokens (dark backgrounds break when surfaces are hard-coded). */
export const HARD_CODED_COLOUR =
  /\b(?:(?:hover|focus|active|disabled|group-hover|placeholder|focus-visible):)?(?:bg|text|border|divide|ring|outline|from|via|to|fill|stroke|decoration|placeholder)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d{1,3})?\b/;

/** Secret-shaped literals (test secrets must be generated at runtime). */
export const SECRET_SHAPED =
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}|\bwhsec_[A-Za-z0-9]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** A service base URL read from the environment (e.g. STRIPE_API_BASE, TURBINEH_AI_URL), excluding the app's own. */
const SERVICE_ENV = /\b([A-Z][A-Z0-9_]*_(?:API_BASE|BASE_URL|API_URL|AI_URL))\b/g;

export interface AgentReadyIssue {
  where: string;
  rule:
    | "guide-missing"
    | "guide-path-missing"
    | "hard-coded-colour"
    | "secret-shaped-literal"
    | "next-dev-types"
    | "service-without-mock"
    | "route-without-doc"
    | "local-db-missing"
    | "required-allow-list"
    | "required-env-undocumented"
    | "e2e-ambient-url"
    | "acceptance-missing"
    | "acceptance-test-missing";
  message: string;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Source files of one template/files tree, as paths relative to that tree. */
function sources(dir: string): { rel: string; text: string }[] {
  return walk(dir)
    .filter((p) => /\.(ts|tsx|mjs|js|css|json)$/.test(p) || p.endsWith(".env.example"))
    .map((p) => ({ rel: relative(dir, p), text: readFileSync(p, "utf8") }));
}

/** Checks shared by recipe templates and component files. */
export function checkTree(
  label: string,
  dir: string,
  chainDirs: string[] = [dir],
): AgentReadyIssue[] {
  const issues: AgentReadyIssue[] = [];
  const files = sources(dir);
  const existsInChain = (rel: string) => chainDirs.some((d) => existsSync(join(d, rel)));
  // A mock may also serve related variables it names (e.g. the AI mock sets AI_BASE_URL next to TURBINEH_AI_URL).
  const mockMentions = (env: string) =>
    chainDirs.some((d) =>
      walk(join(d, "tests/e2e/mocks")).some((f) => readFileSync(f, "utf8").includes(env)),
    );
  for (const f of files) {
    const where = `${label}/${f.rel}`;
    if (/\.(tsx?|css)$/.test(f.rel) && !f.rel.includes("contract.test")) {
      const lines = f.text.split("\n");
      lines.forEach((line, i) => {
        const m = HARD_CODED_COLOUR.exec(line);
        if (m)
          issues.push({
            where: `${where}:${i + 1}`,
            rule: "hard-coded-colour",
            message: `"${m[0]}" bypasses the theme; use a token (bg-surface, bg-panel, bg-subtle, text-ink, text-muted, border-line, border-field, bg-brand, text-accent, text-danger, text-success, text-warning, text-info…).`,
          });
      });
    }
    const secret = SECRET_SHAPED.exec(f.text);
    if (secret)
      issues.push({
        where,
        rule: "secret-shaped-literal",
        message:
          "Secret-shaped literal in a tracked file: generate test secrets at runtime (see playwright.config.ts).",
      });
    if (f.rel === "tsconfig.json" && !f.text.includes(".next/dev/types/**/*.ts"))
      issues.push({
        where,
        rule: "next-dev-types",
        message:
          'tsconfig "include" must list ".next/dev/types/**/*.ts" (Next 16 rewrites it otherwise).',
      });
    if (/^src\/.*\.(ts|tsx)$/.test(f.rel) && /\bfetch\(/.test(f.text)) {
      for (const m of f.text.matchAll(SERVICE_ENV)) {
        const env = m[1] as string;
        if (
          !existsInChain(`tests/e2e/mocks/${env}.mjs`) &&
          !existsInChain(`tests/e2e/mocks/${env}.ts`) &&
          !mockMentions(env)
        )
          issues.push({
            where,
            rule: "service-without-mock",
            message: `Calls an external service configured by ${env} but ships no tests/e2e/mocks/${env}.(mjs|ts) (offline E2E).`,
          });
      }
    }
    if (/^src\/app\/.*\/(page\.tsx|route\.ts|actions\.ts)$/.test(f.rel) && !/^\/\*\*/m.test(f.text))
      issues.push({
        where,
        rule: "route-without-doc",
        message:
          "Add a one-line /** doc */ before the default export (pages) or first export (routes, actions): AGENTS.md lists it.",
      });
  }
  return [...new Map(issues.map((i) => [`${i.where}|${i.rule}|${i.message}`, i])).values()];
}

/** Variables src/env.ts requires: declared without `.optional()` or `.default(` (NODE_ENV aside). */
export function requiredEnvVars(envTs: string): string[] {
  const keys = [...envTs.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)];
  return keys
    .filter((k, i) => {
      const chunk = envTs.slice(k.index, keys[i + 1]?.index ?? envTs.length);
      return !/\.optional\(\)|\.default\(/.test(chunk) && k[1] !== "NODE_ENV";
    })
    .map((k) => k[1] as string);
}

/** Allow-lists (staff emails, allowed domains…): optional at build time, deny by default at runtime. */
const ALLOW_LIST = /(?:_EMAILS|_DOMAINS|ALLOWLIST|ALLOW_LIST|^ALLOWED_[A-Z_]+)$/;

/** Dev dependencies that carry the zero-setup local database (pinned exactly). */
export const LOCAL_DB_DEPENDENCIES = [
  "embedded-postgres",
  "@electric-sql/pglite",
  "@electric-sql/pglite-pgvector",
  "@electric-sql/pglite-socket",
];

/**
 * Zero-friction package checks (ADR-0035) on the files the app will actually have: for each path, the first template
 * in the chain (recipe, then what it extends) that ships it.
 */
export function checkPackage(label: string, chainDirs: string[]): AgentReadyIssue[] {
  const issues: AgentReadyIssue[] = [];
  const effective = (rel: string) => {
    const dir = chainDirs.find((d) => existsSync(join(d, rel)));
    return dir ? { where: `${label}/${rel}`, text: readFileSync(join(dir, rel), "utf8") } : null;
  };
  const pkg = effective("package.json");
  if (pkg) {
    const json = JSON.parse(pkg.text) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const scripts = json.scripts ?? {};
    const viaLocalDb = (name: string) => (scripts[name] ?? "").includes("scripts/local-db.ts");
    const missing = [
      ...(scripts["db:local"]?.includes("scripts/local-db.ts --serve") ? [] : ["db:local"]),
      ...["db:migrate", "test:e2e", "dev"].filter((n) => !viaLocalDb(n)),
      ...(effective("scripts/local-db.ts") ? [] : ["scripts/local-db.ts"]),
      ...LOCAL_DB_DEPENDENCIES.filter(
        (d) => !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(json.devDependencies?.[d] ?? ""),
      ),
    ];
    if (missing.length)
      issues.push({
        where: pkg.where,
        rule: "local-db-missing",
        message: `Zero-setup database incomplete (${missing.join(", ")}): db:migrate, dev and test:e2e run through scripts/local-db.ts, \`pnpm db:local\` serves it, its engines are pinned dev dependencies.`,
      });
  }
  const envTs = effective("src/env.ts");
  if (envTs) {
    const required = requiredEnvVars(envTs.text);
    for (const name of required.filter((n) => ALLOW_LIST.test(n)))
      issues.push({
        where: envTs.where,
        rule: "required-allow-list",
        message: `${name} is required: allow-lists must be optional (\`.default("")\`) and deny by default at runtime, so build and tests need only the documented required env.`,
      });
    const example = effective(".env.example");
    const documented = new Set(
      [...(example?.text ?? "").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
    );
    for (const name of required.filter((n) => !documented.has(n)))
      issues.push({
        where: envTs.where,
        rule: "required-env-undocumented",
        message: `${name} is required by src/env.ts but not documented in .env.example.`,
      });
  }
  const pw = effective("playwright.config.ts");
  if (
    pw &&
    (!/process\.env\.BETTER_AUTH_URL = /.test(pw.text) ||
      /process\.env\.BETTER_AUTH_URL \|\|=|process\.env\.PORT \?\?/.test(pw.text))
  )
    issues.push({
      where: pw.where,
      rule: "e2e-ambient-url",
      message:
        "E2E must own its URLs: set process.env.BETTER_AUTH_URL (and the server port) unconditionally, ignoring ambient values.",
    });
  return issues;
}

/** Tests an acceptance.yaml points at ("<file> › <title>") must exist with that exact title in one of `dirs`. */
export function checkAcceptance(file: string, where: string, dirs: string[]): AgentReadyIssue[] {
  if (!existsSync(file)) return [];
  const raw = parse(readFileSync(file, "utf8")) as unknown;
  const rules = Array.isArray(raw) ? (raw as { test?: unknown; covers?: unknown }[]) : [];
  const issues: AgentReadyIssue[] = [];
  for (const r of rules) {
    const test = typeof r.test === "string" ? r.test : "";
    const covers = Array.isArray(r.covers) ? r.covers.map(String) : [];
    const bad = covers.filter((c) => {
      try {
        new RegExp(c, "i");
        return false;
      } catch {
        return true;
      }
    });
    const [path, title] = test.split(" › ");
    const exists =
      !title ||
      dirs.some((d) => {
        const p = join(d, path ?? "");
        return existsSync(p) && readFileSync(p, "utf8").includes(`"${title}"`);
      });
    if (!test || covers.length === 0 || bad.length || !exists)
      issues.push({
        where,
        rule: "acceptance-test-missing",
        message: !exists
          ? `"${test}" is not a test shipped in this template (file › exact title).`
          : `Rule "${test}" needs a test and valid regexes in covers${bad.length ? ` (invalid: ${bad.join(", ")})` : ""}.`,
      });
  }
  return issues;
}

interface RecipeYaml {
  id: string;
  extends: string | null;
  guide?: { extend?: { what?: unknown; where?: unknown; how?: unknown }[] };
}

/** Every recipe: guide inputs present and pointing at real files, plus the tree checks on its template. */
export function checkRecipes(recipesDir: string): AgentReadyIssue[] {
  if (!existsSync(recipesDir)) return [];
  const ids = readdirSync(recipesDir).filter((d) => existsSync(join(recipesDir, d, "recipe.yaml")));
  const meta = new Map(
    ids.map((id) => [
      id,
      parse(readFileSync(join(recipesDir, id, "recipe.yaml"), "utf8")) as RecipeYaml,
    ]),
  );
  const chainOf = (id: string): string[] => {
    const out: string[] = [];
    for (
      let cur: string | null = id;
      cur && !out.includes(cur);
      cur = meta.get(cur)?.extends ?? null
    )
      out.push(cur);
    return out.map((r) => join(recipesDir, r, "template"));
  };
  const issues: AgentReadyIssue[] = [];
  for (const id of ids) {
    const m = meta.get(id) as RecipeYaml;
    const extend = m.guide?.extend ?? [];
    const label = `recipes/${id}`;
    if (
      extend.length === 0 ||
      extend.some(
        (e) =>
          typeof e.what !== "string" || typeof e.where !== "string" || typeof e.how !== "string",
      )
    ) {
      issues.push({
        where: `${label}/recipe.yaml`,
        rule: "guide-missing",
        message:
          "recipe.yaml needs guide.extend: [{ what, where, how }] (extension points for AGENTS.md).",
      });
    }
    const chain = chainOf(id);
    for (const e of extend) {
      for (const path of String(e.where ?? "").match(/\bsrc\/[\w./[\]-]+\.(?:tsx?|css)\b/g) ?? []) {
        if (!chain.some((d) => existsSync(join(d, path))))
          issues.push({
            where: `${label}/recipe.yaml`,
            rule: "guide-path-missing",
            message: `guide.extend points to ${path}, which does not exist in the template chain.`,
          });
      }
    }
    issues.push(...checkTree(`${label}/template`, join(recipesDir, id, "template"), chain));
    issues.push(...checkPackage(`${label}/template`, chain));
    // Acceptance criteria → tests (ADR-0035): every recipe chain proves its common criteria with shipped tests.
    const ymls = chainOf(id).map((d) => join(d, "..", "acceptance.yaml"));
    if (!ymls.some((f) => existsSync(f)))
      issues.push({
        where: `${label}/acceptance.yaml`,
        rule: "acceptance-missing",
        message:
          "No acceptance.yaml in the recipe chain: map the criteria this recipe proves to its tests (file › title).",
      });
    issues.push(
      ...checkAcceptance(
        join(recipesDir, id, "acceptance.yaml"),
        `${label}/acceptance.yaml`,
        chain,
      ),
    );
  }
  return issues;
}

/** Native components (files/ copied into apps). The base recipe tree also provides mocks they rely on. */
export function checkComponents(componentsDir: string): AgentReadyIssue[] {
  if (!existsSync(componentsDir)) return [];
  return readdirSync(componentsDir)
    .filter((d) => existsSync(join(componentsDir, d, "files")))
    .flatMap((d) => {
      const dirs = shippedDirs(join(componentsDir, d)).filter((x) => existsSync(x));
      return [
        ...dirs
          .filter((x) => !x.endsWith("files-ai"))
          .flatMap((x) =>
            checkTree(`components/${d}/${relative(join(componentsDir, d), x)}`, x, [
              x,
              join(componentsDir, d, "files"),
            ]),
          ),
        ...checkAcceptance(
          join(componentsDir, d, "acceptance.yaml"),
          `components/${d}/acceptance.yaml`,
          dirs,
        ),
      ];
    });
}
