import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";

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
    | "route-without-doc";
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
        if (!existsInChain(`tests/e2e/mocks/${env}.mjs`))
          issues.push({
            where,
            rule: "service-without-mock",
            message: `Calls an external service configured by ${env} but ships no tests/e2e/mocks/${env}.mjs (offline E2E).`,
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
  }
  return issues;
}

/** Native components (files/ copied into apps). The base recipe tree also provides mocks they rely on. */
export function checkComponents(componentsDir: string): AgentReadyIssue[] {
  if (!existsSync(componentsDir)) return [];
  return readdirSync(componentsDir)
    .filter((d) => existsSync(join(componentsDir, d, "files")))
    .flatMap((d) => checkTree(`components/${d}/files`, join(componentsDir, d, "files")));
}
