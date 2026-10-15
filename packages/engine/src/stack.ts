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
 * Canonical framework id from what a person types or picks ("Next.js", "next", "Vite + React"…). The web wizard
 * sends display names; before ADR-0050 "Next.js" became "next.js", which never matched "nextjs" and blocked the main
 * path with "pages need porting".
 */
export function normalizeFramework(name: string | null | undefined): string | null {
  const raw = (name ?? "").trim().toLowerCase();
  if (!raw) return null;
  const key = raw.replace(/[\s._-]/g, "");
  const known: Record<string, string> = {
    next: "nextjs",
    nextjs: "nextjs",
    vite: "vite",
    "vite+react": "vite",
    react: "vite",
    nest: "nestjs",
    nestjs: "nestjs",
    express: "express",
    expressjs: "express",
    remix: "remix",
    hono: "hono",
    fastify: "fastify",
    nuxt: "nuxt",
    nuxtjs: "nuxt",
    sveltekit: "sveltekit",
    astro: "astro",
    django: "django",
    fastapi: "fastapi",
    flask: "flask",
    gin: "gin",
    "net/http": "net/http",
    rails: "rails",
    rubyonrails: "rails",
    laravel: "laravel",
  };
  return known[key] ?? raw;
}

const FRAMEWORK_LABELS: Record<string, string> = {
  nextjs: "Next.js",
  vite: "Vite + React",
  nestjs: "NestJS",
  express: "Express",
  remix: "Remix",
  hono: "Hono",
  fastify: "Fastify",
  nuxt: "Nuxt",
  sveltekit: "SvelteKit",
  astro: "Astro",
  django: "Django",
  fastapi: "FastAPI",
  flask: "Flask",
  gin: "Gin",
  "net/http": "Go net/http",
  rails: "Ruby on Rails",
  laravel: "Laravel",
};
const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  go: "Go",
  ruby: "Ruby",
  php: "PHP",
};

/** Display name for a framework or language id ("nextjs" → "Next.js"). */
export const frameworkLabel = (id: string | null | undefined): string =>
  id ? (FRAMEWORK_LABELS[id] ?? id) : "";
export const languageLabel = (id: string): string => LANGUAGE_LABELS[id] ?? id;

/**
 * Stack from a repository's manifests, uploaded files or a declared stack. Deterministic. A declared stack (no
 * repository, no files) means a new project: TurbineH builds a complete app, so nothing is left to adapt (ADR-0050).
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
      language: env.stack.language.trim().toLowerCase() || "typescript",
      framework: normalizeFramework(env.stack.framework),
      packageManager: null,
      versions: env.stack.versions ?? {},
      source,
      adaptationPending: false,
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

/** The project's declared npm dependencies (name → cleaned version), to plan only what is really new. */
export function projectDependencies(files: Record<string, string>): Record<string, string> {
  try {
    const pkg = JSON.parse(files["package.json"] ?? "{}") as PackageJson;
    const out: Record<string, string> = {};
    for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }))
      out[name] = cleanVersion(range) ?? range;
    return out;
  } catch {
    return {};
  }
}

/**
 * Splits the package's dependencies into new ones (added by apply) and the ones the project already has; a different
 * major version is an incompatibility (apply keeps the project's version).
 */
export function dependencyDiff(
  deps: { name: string; version: string }[],
  project: Record<string, string> | undefined,
): { added: { name: string; version: string }[]; conflicts: string[] } {
  if (!project) return { added: deps, conflicts: [] };
  const added: { name: string; version: string }[] = [];
  const conflicts: string[] = [];
  for (const d of deps) {
    const have = project[d.name];
    if (have === undefined) added.push(d);
    else if (
      Number.isFinite(major(have)) &&
      Number.isFinite(major(d.version)) &&
      major(have) !== major(d.version)
    )
      conflicts.push(
        `${d.name}: your project has ${have}, the package was verified with ${d.version}. Your version is kept; the checks in your project (pull request or \`turbineh verify\`) show whether it works. To be safe, upgrade ${d.name} to ${major(d.version)}.`,
      );
  }
  return { added, conflicts };
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
 *
 * Every message says what happened, what it means for the person and what to do next (ADR-0050). A declared stack
 * is a new project: TurbineH builds a complete app, so a declared stack is never "incompatible" — `planOutcome`
 * explains what the person gets for stacks other than Next.js and offers a complete Next.js app in one click.
 */
export function compatibility(stack: DetectedStack, kind: "use_case" | "component"): Compatibility {
  const incompatibilities: string[] = [];
  const missing: string[] = [];
  if (stack.source === "declared") return { compatible: true, incompatibilities, missing };
  const js = stack.language === "typescript" || stack.language === "javascript";
  const fw = frameworkLabel(stack.framework);
  if (stack.language === "unknown") {
    missing.push(
      "We could not tell your project's stack from the files you sent. Connect the repository or upload its package.json — or build a new, complete app instead.",
    );
  } else if (!js) {
    incompatibilities.push(
      `Your project is written in ${languageLabel(stack.language)} and TurbineH builds TypeScript apps, so nothing can be added inside your code. You get a complete, verified Next.js app that runs as its own service next to yours (your code calls it over HTTP). Approve to continue, or build a standalone Next.js app instead.`,
    );
  }
  if (kind === "use_case" && js) {
    if (stack.framework && stack.framework !== "nextjs") {
      incompatibilities.push(
        `Your project uses ${fw} and TurbineH builds Next.js apps. You get a complete, verified Next.js app: its server code under src/ (data access, validation, business rules) is plain TypeScript you can import into ${fw}; its screens are Next.js pages, so ${fw} does not use them — rebuild them in ${fw} or run the Next.js app next to yours. Approve to continue, or build a standalone Next.js app instead.`,
      );
    }
    const next = major(stack.versions.next);
    if (stack.framework === "nextjs" && Number.isFinite(next) && next < 15) {
      incompatibilities.push(
        `Your project uses Next.js ${stack.versions.next}; the package needs Next.js 15 or later (it is verified on ${TARGET_STACK.versions.next}). Upgrade Next.js in your project first (\`npx @next/codemod upgrade\`), or build a standalone app instead.`,
      );
    }
    if (stack.language === "javascript") {
      missing.push(
        "Your project is JavaScript and the package is TypeScript: add a tsconfig.json with `allowJs` so both work together (the package's README shows how).",
      );
    }
  }
  const nodeMajor = major(stack.versions.node);
  if (Number.isFinite(nodeMajor) && nodeMajor < 20) {
    incompatibilities.push(
      `Your project runs on Node.js ${stack.versions.node}; the package needs Node.js 20 or later. Upgrade Node.js (\`.nvmrc\` or \`engines.node\` in package.json) and approve to continue.`,
    );
  }
  return { compatible: incompatibilities.length === 0, incompatibilities, missing };
}
