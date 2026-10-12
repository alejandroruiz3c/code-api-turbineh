import type { DetectedStack, EnvironmentInput } from "@turbineh/shared";

/**
 * Files that are enough to understand a project's stack. The CLI and the web upload send only these (never source
 * code or secrets) to plan.
 */
export const MANIFEST_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "tsconfig.json",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "nuxt.config.ts",
  "svelte.config.js",
  "vite.config.ts",
  "astro.config.mjs",
  "drizzle.config.ts",
  "prisma/schema.prisma",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Gemfile",
  "composer.json",
  ".nvmrc",
] as const;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
  packageManager?: string;
}

/** "^16.0.3" → "16.0.3", "~15" → "15", "workspace:*" → null. */
export function cleanVersion(range: string | undefined): string | null {
  const m = /(\d+(?:\.\d+){0,2})/.exec(range ?? "");
  return m?.[1] ?? null;
}

export const major = (v: string | null | undefined) =>
  v ? Number(/^(\d+)/.exec(v)?.[1] ?? NaN) : NaN;

const FRAMEWORKS: [dep: string, name: string][] = [
  ["next", "nextjs"],
  ["nuxt", "nuxt"],
  ["@sveltejs/kit", "sveltekit"],
  ["astro", "astro"],
  ["@remix-run/react", "remix"],
  ["@nestjs/core", "nestjs"],
  ["express", "express"],
  ["fastify", "fastify"],
  ["hono", "hono"],
  ["vite", "vite"],
];

/** Versions worth reporting (they decide compatibility). */
const TRACKED = [
  "next",
  "react",
  "typescript",
  "drizzle-orm",
  "@prisma/client",
  "pg",
  "zod",
  "better-auth",
  "next-auth",
  "@clerk/nextjs",
  "stripe",
  "tailwindcss",
  "vitest",
  "@playwright/test",
];

/**
 * Stack from a repository's manifests, uploaded files or a declared stack. Deterministic; a declared stack is marked
 * `adaptationPending` because adapting to the concrete project is still to be done (PLAN §16.2).
 */
export function detectStack(env: EnvironmentInput): DetectedStack {
  const files = env.files ?? {};
  const source: DetectedStack["source"] = env.repo
    ? "repo"
    : env.stack && !files["package.json"]
      ? "declared"
      : "files";
  if (source === "declared" && env.stack) {
    return {
      language: env.stack.language.toLowerCase(),
      framework: env.stack.framework?.toLowerCase() ?? null,
      packageManager: null,
      versions: env.stack.versions ?? {},
      source,
      adaptationPending: true,
    };
  }
  const pkg = ((): PackageJson => {
    try {
      return files["package.json"] ? (JSON.parse(files["package.json"]) as PackageJson) : {};
    } catch {
      return {};
    }
  })();
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (f: string) => typeof files[f] === "string";
  const versions: Record<string, string> = {};
  for (const name of TRACKED) {
    const v = cleanVersion(deps[name]);
    if (v) versions[name] = v;
  }
  const node = cleanVersion(pkg.engines?.node) ?? cleanVersion(files[".nvmrc"]);
  if (node) versions.node = node;

  let language = "unknown";
  if (files["package.json"])
    language = has("tsconfig.json") || deps.typescript ? "typescript" : "javascript";
  else if (has("pyproject.toml") || has("requirements.txt")) language = "python";
  else if (has("go.mod")) language = "go";
  else if (has("Gemfile")) language = "ruby";
  else if (has("composer.json")) language = "php";

  const framework = FRAMEWORKS.find(([dep]) => dep in deps)?.[1] ?? null;
  const pm = pkg.packageManager?.split("@")[0];
  const packageManager =
    pm ??
    (has("pnpm-lock.yaml")
      ? "pnpm"
      : has("yarn.lock")
        ? "yarn"
        : has("bun.lock") || has("bun.lockb")
          ? "bun"
          : has("package-lock.json")
            ? "npm"
            : files["package.json"]
              ? "npm"
              : null);
  return { language, framework, packageManager, versions, source, adaptationPending: false };
}

/** What TurbineH flows are built and verified on (the recipes' template stack). */
export const TARGET_STACK = {
  language: "typescript",
  framework: "nextjs",
  versions: { next: "16", react: "19", node: "20" },
  database: "postgres",
} as const;

export interface Compatibility {
  compatible: boolean;
  incompatibilities: string[];
  missing: string[];
}

/**
 * Deterministic compatibility between the detected stack and what a capability needs. Full flows are Next.js
 * (App Router) + TypeScript + PostgreSQL; standalone components need a JS/TS runtime; the AI orchestrator is also
 * reachable over HTTP from any language.
 */
export function compatibility(stack: DetectedStack, kind: "use_case" | "component"): Compatibility {
  const incompatibilities: string[] = [];
  const missing: string[] = [];
  const js = stack.language === "typescript" || stack.language === "javascript";
  if (stack.language === "unknown") {
    missing.push(
      "The project's stack: connect the repository, upload package.json or declare the stack.",
    );
  } else if (!js) {
    incompatibilities.push(
      `${stack.language} project: TurbineH packages are TypeScript. Use the package as a separate service, or integrate the AI orchestrator over HTTP.`,
    );
  }
  if (kind === "use_case" && js) {
    if (stack.framework && stack.framework !== "nextjs") {
      incompatibilities.push(
        `${stack.framework} detected: this flow ships Next.js App Router routes. Its server modules (src/) can be reused; the pages need porting.`,
      );
    }
    const next = major(stack.versions.next);
    if (stack.framework === "nextjs" && Number.isFinite(next) && next < 15) {
      incompatibilities.push(
        `Next.js ${stack.versions.next} detected: the package targets Next.js ${TARGET_STACK.versions.next} (App Router, async request APIs). Upgrade or adapt the route handlers.`,
      );
    }
    if (stack.language === "javascript") {
      missing.push(
        "TypeScript: the package is written in TypeScript (add a tsconfig.json or transpile the modules).",
      );
    }
  }
  const nodeMajor = major(stack.versions.node);
  if (Number.isFinite(nodeMajor) && nodeMajor < 20) {
    incompatibilities.push(
      `Node.js ${stack.versions.node} detected: Node.js 20 or later is required.`,
    );
  }
  if (stack.adaptationPending) {
    missing.push(
      "Adaptation to your concrete project is pending: only the stack was declared, no project files were analysed.",
    );
  }
  return { compatible: incompatibilities.length === 0, incompatibilities, missing };
}
