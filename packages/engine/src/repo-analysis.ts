import { posix } from "node:path";
import type { RepositoryFit } from "@turbineh/shared";
import { cleanVersion, major } from "./stack.js";

/**
 * Repository analysis (PLAN §16 P5, ADR-0034): what a client's project is made of and how it is written, from its
 * file list and a small set of configuration files read through the GitHub API — never cloned, never a secret. Env
 * files are reported by name only; their contents are never requested. Deterministic: the adaptation decisions that
 * follow from it are code, not a model.
 */

/** Paths never read, whatever their name suggests (secrets and build output). */
const NEVER_READ =
  /(^|\/)(\.env(?!\.(example|sample|template)$)(\..*)?|.*\.(pem|key|p12|pfx|crt|keystore)|id_(rsa|ed25519)(\.pub)?|\.npmrc|\.yarnrc(\.yml)?|\.netrc|secrets?\.(json|ya?ml))$|(^|\/)(node_modules|\.next|dist|build|out|\.turbo|\.vercel|coverage)\//i;

export const isReadable = (path: string): boolean => !NEVER_READ.test(path);

const ENV_FILE = /(^|\/)\.env(\.[\w.-]+)?$/;
const IGNORED_DIR = /(^|\/)(node_modules|\.next|dist|build|out|\.turbo|\.vercel|coverage|\.git)\//;

export interface RepoAnalysis {
  repo: string;
  ref: string;
  /** Path of the application inside the repository ("" = root; "apps/web" in a monorepo). */
  appPath: string;
  monorepo: { tool: string | null; packages: string[]; apps: string[] } | null;
  packageManager: { name: "pnpm" | "npm" | "yarn" | "bun" | null; lockfile: string | null };
  language: "typescript" | "javascript" | "other";
  framework: {
    name: string | null;
    version: string | null;
    router: "app" | "pages" | "app+pages" | null;
    appDir: string | null;
    pagesDir: string | null;
    config: string | null;
  };
  /** Source root the project uses for its own modules ("src" or "" for the app root). */
  sourceRoot: string;
  typescript: {
    version: string | null;
    strict: boolean | null;
    /** tsconfig paths, e.g. { "@/*": ["./src/*"] }. */
    aliases: Record<string, string[]>;
    baseUrl: string | null;
  };
  moduleType: "module" | "commonjs";
  styling: { tailwind: string | null; ui: string[] };
  auth: { library: string | null; version: string | null };
  orm: {
    library: "drizzle" | "prisma" | "typeorm" | "kysely" | "mongoose" | "sequelize" | null;
    version: string | null;
    config: string | null;
    schema: string | null;
    migrationsDir: string | null;
    /** Module that exports the database client, when found (e.g. src/db/index.ts). */
    clientModule: string | null;
  };
  database: string | null;
  validation: { library: string | null; version: string | null };
  /** Env file names only (never their contents). */
  envFiles: string[];
  envExample: string | null;
  ci: string[];
  tests: { runner: "vitest" | "jest" | null; e2e: "playwright" | "cypress" | null };
  lint: { eslint: boolean; biome: boolean; prettier: boolean };
  scripts: { build: boolean; lint: boolean; typecheck: boolean; test: boolean };
  node: string | null;
  versions: Record<string, string>;
  /** One line per convention, in plain words (shown in the UI and the PR). */
  conventions: string[];
}

interface Pkg {
  name?: string;
  type?: string;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
  packageManager?: string;
}

const parseJson = <T>(text: string | undefined): T | null => {
  if (text === undefined) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    // tsconfig allows comments and trailing commas.
    try {
      return JSON.parse(
        text
          .replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (_m, s: string) => s ?? "")
          .replace(/,(\s*[}\]])/g, "$1"),
      ) as T;
    } catch {
      return null;
    }
  }
};

const join = (...p: string[]) => posix.join(...p.filter(Boolean)).replace(/^\.\//, "");
const under = (base: string, p: string) => (base ? `${base}/${p}` : p);

/** Phase 1: what to read first — root manifests and every package.json of a workspace (up to 3 levels). */
export function firstReadList(paths: string[]): string[] {
  const root = [
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
    "nx.json",
    "lerna.json",
    ".nvmrc",
    ".node-version",
  ];
  const pkgs = paths
    .filter((p) => /(^|\/)package\.json$/.test(p) && !IGNORED_DIR.test(p))
    .filter((p) => p.split("/").length <= 4)
    .sort((a, b) => a.split("/").length - b.split("/").length)
    .slice(0, 40);
  return [...new Set([...root.filter((f) => paths.includes(f)), ...pkgs])];
}

const FRAMEWORK_DEPS: [string, string][] = [
  ["next", "nextjs"],
  ["nuxt", "nuxt"],
  ["@sveltejs/kit", "sveltekit"],
  ["astro", "astro"],
  ["@remix-run/react", "remix"],
  ["react-router", "react-router"],
  ["@nestjs/core", "nestjs"],
  ["express", "express"],
  ["fastify", "fastify"],
  ["hono", "hono"],
  ["vite", "vite"],
];

const allDeps = (p: Pkg | null): Record<string, string> => ({
  ...p?.devDependencies,
  ...p?.dependencies,
});

/**
 * Which package is the application: the root when it has a framework, otherwise the workspace package with Next.js
 * (preferring apps/web, then apps/*), otherwise the first package with a framework.
 */
export function pickAppPath(files: Record<string, string>, preferred?: string): string {
  const pkgPaths = Object.keys(files).filter((p) => /(^|\/)package\.json$/.test(p));
  const dirOf = (p: string) => (p === "package.json" ? "" : p.slice(0, -"/package.json".length));
  if (preferred !== undefined && pkgPaths.includes(under(preferred, "package.json")))
    return preferred;
  const withDeps = pkgPaths.map((p) => ({
    dir: dirOf(p),
    deps: allDeps(parseJson<Pkg>(files[p])),
  }));
  const root = withDeps.find((x) => x.dir === "");
  if (root && "next" in root.deps) return "";
  const next = withDeps
    .filter((x) => x.dir && "next" in x.deps)
    .sort(
      (a, b) =>
        Number(b.dir === "apps/web") - Number(a.dir === "apps/web") ||
        Number(b.dir.startsWith("apps/")) - Number(a.dir.startsWith("apps/")) ||
        a.dir.length - b.dir.length,
    );
  if (next[0]) return next[0].dir;
  if (root && FRAMEWORK_DEPS.some(([d]) => d in root.deps)) return "";
  const other = withDeps.find((x) => x.dir && FRAMEWORK_DEPS.some(([d]) => d in x.deps));
  return other?.dir ?? "";
}

const CONFIG_NAMES = [
  "tsconfig.json",
  "jsconfig.json",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "components.json",
  "drizzle.config.ts",
  "drizzle.config.js",
  "drizzle.config.mjs",
  "prisma/schema.prisma",
  "tailwind.config.ts",
  "tailwind.config.js",
  "postcss.config.mjs",
  "postcss.config.js",
  "vitest.config.ts",
  "vitest.config.mts",
  "vitest.config.js",
  "jest.config.ts",
  "jest.config.js",
  "playwright.config.ts",
  ".env.example",
  ".env.sample",
];

/** Phase 2: the app's configuration files, plus likely database-client modules (to reuse them). */
export function secondReadList(
  paths: string[],
  appPath: string,
  firstFiles: Record<string, string>,
): string[] {
  const set = new Set(paths);
  const out = CONFIG_NAMES.map((f) => under(appPath, f)).filter((f) => set.has(f));
  // Root-level configs in monorepos (shared tsconfig, root .env.example).
  for (const f of ["tsconfig.json", "tsconfig.base.json", ".env.example"])
    if (appPath && set.has(f)) out.push(f);
  const deps = allDeps(parseJson<Pkg>(firstFiles[under(appPath, "package.json")]));
  if ("drizzle-orm" in deps) out.push(...dbModuleCandidates(paths, appPath));
  return [...new Set(out)].filter(isReadable);
}

/** Files that usually export the Drizzle client (src/db/index.ts, lib/db.ts, server/db/index.ts…). */
export function dbModuleCandidates(paths: string[], appPath: string): string[] {
  const prefix = appPath ? `${appPath}/` : "";
  return paths
    .filter((p) => p.startsWith(prefix) && !IGNORED_DIR.test(p))
    .map((p) => p.slice(prefix.length))
    .filter((p) =>
      /^(src\/)?(lib\/|server\/)?(db|database|drizzle)(\/(index|client|db|drizzle))?\.(ts|js|mts)$/.test(
        p,
      ),
    )
    .sort((a, b) => a.length - b.length)
    .slice(0, 6)
    .map((p) => under(appPath, p));
}

const AUTH_LIBS = [
  "better-auth",
  "next-auth",
  "@auth/core",
  "@clerk/nextjs",
  "lucia",
  "@supabase/ssr",
  "@supabase/auth-helpers-nextjs",
  "@kinde-oss/kinde-auth-nextjs",
  "@workos-inc/authkit-nextjs",
  "firebase",
];
const UI_LIBS: [string, string][] = [
  ["@radix-ui/react-slot", "Radix UI"],
  ["radix-ui", "Radix UI"],
  ["@mui/material", "MUI"],
  ["@chakra-ui/react", "Chakra UI"],
  ["@mantine/core", "Mantine"],
  ["@headlessui/react", "Headless UI"],
  ["antd", "Ant Design"],
  ["@heroui/react", "HeroUI"],
];
const DB_DRIVERS: [string, string][] = [
  ["pg", "postgres"],
  ["postgres", "postgres"],
  ["@neondatabase/serverless", "postgres"],
  ["@vercel/postgres", "postgres"],
  ["mysql2", "mysql"],
  ["@planetscale/database", "mysql"],
  ["better-sqlite3", "sqlite"],
  ["@libsql/client", "sqlite"],
  ["mongodb", "mongodb"],
  ["mongoose", "mongodb"],
];

/** Drizzle config → `schema` and `out` (string literals only; anything computed is reported as unknown). */
export function drizzleConfig(text: string | undefined): {
  schema: string | null;
  out: string | null;
  dialect: string | null;
} {
  if (!text) return { schema: null, out: null, dialect: null };
  const str = (key: string) =>
    new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
  return { schema: str("schema"), out: str("out"), dialect: str("dialect") ?? str("driver") };
}

/** Prisma datasource provider (postgresql, mysql, sqlite…). */
const prismaProvider = (text: string | undefined) =>
  /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/.exec(text ?? "")?.[1] ?? null;

/** Full analysis from the file list and the files read in both phases. */
export function analyseRepo(input: {
  repo: string;
  ref: string;
  paths: string[];
  files: Record<string, string>;
  appPath?: string;
}): RepoAnalysis {
  const { paths, files } = input;
  const set = new Set(paths);
  const appPath = input.appPath ?? pickAppPath(files);
  const at = (p: string) => under(appPath, p);
  const has = (p: string) => set.has(at(p));
  const rootPkg = parseJson<Pkg>(files["package.json"]);
  const pkg = parseJson<Pkg>(files[at("package.json")]) ?? rootPkg;
  const deps = allDeps(pkg);
  const rootDeps = allDeps(rootPkg);
  const v = (name: string) => cleanVersion(deps[name] ?? rootDeps[name]);
  const prefix = appPath ? `${appPath}/` : "";
  const inApp = paths
    .filter((p) => p.startsWith(prefix) && !IGNORED_DIR.test(p))
    .map((p) => p.slice(prefix.length));

  // Monorepo
  const wsGlobs = Array.isArray(rootPkg?.workspaces)
    ? rootPkg.workspaces
    : (rootPkg?.workspaces?.packages ?? []);
  const pnpmWs = files["pnpm-workspace.yaml"];
  const pkgDirs = Object.keys(files)
    .filter((p) => /\/package\.json$/.test(p))
    .map((p) => p.slice(0, -"/package.json".length));
  const isMonorepo = Boolean(pnpmWs || wsGlobs.length || (pkgDirs.length > 0 && appPath));
  const monorepo = isMonorepo
    ? {
        tool: set.has("turbo.json")
          ? "turborepo"
          : set.has("nx.json")
            ? "nx"
            : pnpmWs
              ? "pnpm workspaces"
              : wsGlobs.length
                ? "npm/yarn workspaces"
                : null,
        packages: pkgDirs.sort(),
        apps: pkgDirs.filter((d) => "next" in allDeps(parseJson<Pkg>(files[`${d}/package.json`]))),
      }
    : null;

  // Package manager (lockfiles live at the repository root in workspaces).
  const lock = ["pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lock", "bun.lockb"].find(
    (f) => set.has(f) || set.has(at(f)),
  );
  const declared = (rootPkg?.packageManager ?? pkg?.packageManager)?.split("@")[0];
  const pmName = (declared ??
    (lock?.startsWith("pnpm")
      ? "pnpm"
      : lock === "yarn.lock"
        ? "yarn"
        : lock?.startsWith("bun")
          ? "bun"
          : lock
            ? "npm"
            : pkg
              ? "npm"
              : null)) as RepoAnalysis["packageManager"]["name"];

  // Framework and router
  const fw = FRAMEWORK_DEPS.find(([d]) => d in deps);
  const appDir = ["src/app", "app"].find((d) =>
    inApp.some((p) => p.startsWith(`${d}/`) && /\/(page|layout|route)\.(t|j)sx?$/.test(p)),
  );
  const pagesDir = ["src/pages", "pages"].find((d) =>
    inApp.some((p) => p.startsWith(`${d}/`) && /\.(t|j)sx?$/.test(p)),
  );
  const router =
    fw?.[1] === "nextjs"
      ? appDir && pagesDir
        ? "app+pages"
        : appDir
          ? "app"
          : pagesDir
            ? "pages"
            : null
      : null;
  const nextConfig =
    ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.cjs"].find(has) ?? null;

  // Source root: src/ when the project keeps its code there.
  const srcFiles = inApp.filter((p) => p.startsWith("src/")).length;
  const sourceRoot =
    appDir?.startsWith("src/") || pagesDir?.startsWith("src/") || srcFiles > 0 ? "src" : "";

  // TypeScript
  const tsconfig = parseJson<{
    compilerOptions?: { strict?: boolean; paths?: Record<string, string[]>; baseUrl?: string };
  }>(files[at("tsconfig.json")] ?? files[at("jsconfig.json")]);
  const language =
    has("tsconfig.json") || "typescript" in deps || "typescript" in rootDeps
      ? "typescript"
      : pkg
        ? "javascript"
        : "other";

  // ORM
  const drizzleCfgPath =
    ["drizzle.config.ts", "drizzle.config.js", "drizzle.config.mjs"].find(has) ?? null;
  const dcfg = drizzleConfig(drizzleCfgPath ? files[at(drizzleCfgPath)] : undefined);
  const prismaSchema = has("prisma/schema.prisma") ? "prisma/schema.prisma" : null;
  const ormLib: RepoAnalysis["orm"]["library"] =
    "drizzle-orm" in deps
      ? "drizzle"
      : "@prisma/client" in deps || "prisma" in deps
        ? "prisma"
        : "typeorm" in deps
          ? "typeorm"
          : "kysely" in deps
            ? "kysely"
            : "mongoose" in deps
              ? "mongoose"
              : "sequelize" in deps
                ? "sequelize"
                : null;
  const clientModule =
    ormLib === "drizzle"
      ? (Object.keys(files)
          .filter((p) => p.startsWith(prefix) && /\bdrizzle\s*\(/.test(files[p] ?? ""))
          .map((p) => p.slice(prefix.length))
          .filter((p) => !/drizzle\.config\./.test(p))
          .sort((a, b) => a.length - b.length)[0] ?? null)
      : null;
  const prismaMigrations = inApp.some((p) => p.startsWith("prisma/migrations/"))
    ? "prisma/migrations"
    : null;
  const drizzleOut = dcfg.out ? join(dcfg.out) : null;
  const orm = {
    library: ormLib,
    version:
      ormLib === "drizzle"
        ? v("drizzle-orm")
        : ormLib === "prisma"
          ? (v("@prisma/client") ?? v("prisma"))
          : ormLib
            ? v(ormLib)
            : null,
    config: ormLib === "drizzle" ? drizzleCfgPath : ormLib === "prisma" ? prismaSchema : null,
    schema: ormLib === "drizzle" ? dcfg.schema : ormLib === "prisma" ? prismaSchema : null,
    migrationsDir:
      ormLib === "drizzle" ? drizzleOut : ormLib === "prisma" ? prismaMigrations : null,
    clientModule,
  };
  const database =
    (ormLib === "prisma" ? prismaProvider(files[at("prisma/schema.prisma")]) : null)?.replace(
      "postgresql",
      "postgres",
    ) ??
    (dcfg.dialect
      ? dcfg.dialect.replace("postgresql", "postgres").replace("turso", "sqlite")
      : null) ??
    DB_DRIVERS.find(([d]) => d in deps)?.[1] ??
    null;

  const auth = AUTH_LIBS.find((l) => l in deps) ?? null;
  const ui = [
    ...new Set([
      ...(has("components.json") ? ["shadcn/ui"] : []),
      ...UI_LIBS.filter(([d]) => d in deps).map(([, n]) => n),
    ]),
  ];
  const tailwind = v("tailwindcss");
  const envFiles = paths.filter((p) => ENV_FILE.test(p) && !IGNORED_DIR.test(p)).sort();
  const envExample =
    [at(".env.example"), at(".env.sample"), ".env.example", ".env.sample"].find((f) =>
      set.has(f),
    ) ?? null;
  const ci = paths
    .filter(
      (p) =>
        /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p) ||
        p === ".gitlab-ci.yml" ||
        p === "vercel.json" ||
        p === "netlify.toml",
    )
    .sort();
  const scripts = pkg?.scripts ?? {};
  const hasTool = (names: string[], file: RegExp) =>
    names.some((n) => n in deps || n in rootDeps) ||
    paths.some((p) => file.test(p) && !IGNORED_DIR.test(p));
  const lint = {
    eslint: hasTool(["eslint"], /(^|\/)(eslint\.config\.\w+|\.eslintrc(\.\w+)?)$/),
    biome: hasTool(["@biomejs/biome"], /(^|\/)biome\.jsonc?$/),
    prettier: hasTool(["prettier"], /(^|\/)(\.prettierrc(\.\w+)?|prettier\.config\.\w+)$/),
  };
  const tests = {
    runner: ("vitest" in deps || "vitest" in rootDeps
      ? "vitest"
      : "jest" in deps || "jest" in rootDeps
        ? "jest"
        : null) as RepoAnalysis["tests"]["runner"],
    e2e: ("@playwright/test" in deps || "@playwright/test" in rootDeps
      ? "playwright"
      : "cypress" in deps || "cypress" in rootDeps
        ? "cypress"
        : null) as RepoAnalysis["tests"]["e2e"],
  };
  const node =
    cleanVersion(pkg?.engines?.node ?? rootPkg?.engines?.node) ??
    cleanVersion(files[".nvmrc"] ?? files[".node-version"]);
  const versions: Record<string, string> = {};
  for (const name of [
    "next",
    "react",
    "typescript",
    "drizzle-orm",
    "@prisma/client",
    "zod",
    "tailwindcss",
    "vitest",
    "jest",
    ...(auth ? [auth] : []),
  ]) {
    const x = v(name);
    if (x) versions[name] = x;
  }
  if (node) versions.node = node;

  const analysis: RepoAnalysis = {
    repo: input.repo,
    ref: input.ref,
    appPath,
    monorepo,
    packageManager: { name: pmName, lockfile: lock ?? null },
    language,
    framework: {
      name: fw?.[1] ?? null,
      version: fw ? v(fw[0]) : null,
      router,
      appDir: appDir ?? null,
      pagesDir: pagesDir ?? null,
      config: nextConfig,
    },
    sourceRoot,
    typescript: {
      version: v("typescript"),
      strict: tsconfig?.compilerOptions?.strict ?? null,
      aliases: tsconfig?.compilerOptions?.paths ?? {},
      baseUrl: tsconfig?.compilerOptions?.baseUrl ?? null,
    },
    moduleType: pkg?.type === "module" ? "module" : "commonjs",
    styling: { tailwind, ui },
    auth: { library: auth, version: auth ? v(auth) : null },
    orm,
    database,
    validation: {
      library: "zod" in deps ? "zod" : "valibot" in deps ? "valibot" : "yup" in deps ? "yup" : null,
      version: v("zod") ?? v("valibot") ?? v("yup"),
    },
    envFiles,
    envExample,
    ci,
    tests,
    lint,
    scripts: {
      build: Boolean(scripts.build),
      lint: Boolean(scripts.lint),
      typecheck: Boolean(scripts.typecheck ?? scripts["type-check"] ?? scripts.tsc),
      test: Boolean(scripts.test && !/no test specified/.test(scripts.test)),
    },
    node,
    versions,
    conventions: [],
  };
  analysis.conventions = describeConventions(analysis);
  return analysis;
}

/** The alias that points at a directory of the app (e.g. "@/" for ./src), if the project has one. */
export function aliasFor(a: RepoAnalysis, dir: string): string | null {
  for (const [key, targets] of Object.entries(a.typescript.aliases)) {
    if (!key.endsWith("/*")) continue;
    for (const t of targets) {
      const target = join(a.typescript.baseUrl ?? ".", t.replace(/\/\*$/, ""));
      if ((target === "" || target === ".") && dir === "") return key.slice(0, -1);
      if (target === dir.replace(/\/$/, "")) return key.slice(0, -1);
    }
  }
  return null;
}

function describeConventions(a: RepoAnalysis): string[] {
  const out: string[] = [];
  if (a.monorepo)
    out.push(
      `Monorepo (${a.monorepo.tool ?? "workspaces"}): the application is ${a.appPath ? `\`${a.appPath}\`` : "the root package"}.`,
    );
  if (a.framework.name === "nextjs")
    out.push(
      `Next.js ${a.framework.version ?? "?"} with the ${a.framework.router === "app+pages" ? "App and Pages routers" : a.framework.router === "pages" ? "Pages Router" : a.framework.router === "app" ? "App Router" : "router not detected"}${a.framework.appDir ? ` in \`${a.framework.appDir}/\`` : a.framework.pagesDir ? ` in \`${a.framework.pagesDir}/\`` : ""}.`,
    );
  else if (a.framework.name) out.push(`${a.framework.name} ${a.framework.version ?? ""}`.trim());
  out.push(a.sourceRoot ? "Code lives under `src/`." : "Code lives at the app root (no `src/`).");
  const alias = aliasFor(a, a.sourceRoot);
  if (alias)
    out.push(`Import alias \`${alias}\` → \`${a.sourceRoot ? `${a.sourceRoot}/` : "./"}\`.`);
  else if (Object.keys(a.typescript.aliases).length)
    out.push(`Import aliases: ${Object.keys(a.typescript.aliases).join(", ")}.`);
  else out.push("No import alias: relative imports.");
  if (a.language === "typescript")
    out.push(
      `TypeScript ${a.typescript.version ?? ""}${a.typescript.strict ? " (strict)" : a.typescript.strict === false ? " (not strict)" : ""}.`.replace(
        "  ",
        " ",
      ),
    );
  if (a.packageManager.name)
    out.push(
      `Package manager: ${a.packageManager.name}${a.packageManager.lockfile ? ` (${a.packageManager.lockfile})` : " (no lockfile)"}.`,
    );
  if (a.styling.tailwind)
    out.push(
      `Tailwind CSS ${a.styling.tailwind}${major(a.styling.tailwind) >= 4 ? " (CSS-first config)" : ""}.`,
    );
  if (a.styling.ui.length) out.push(`UI: ${a.styling.ui.join(", ")}.`);
  if (a.auth.library) out.push(`Authentication: ${a.auth.library} ${a.auth.version ?? ""}.`.trim());
  if (a.orm.library)
    out.push(
      `Database layer: ${a.orm.library} ${a.orm.version ?? ""}${a.orm.migrationsDir ? `, migrations in \`${a.orm.migrationsDir}/\`` : ""}${a.database ? ` (${a.database})` : ""}.`.replace(
        " ,",
        ",",
      ),
    );
  else if (a.database) out.push(`Database driver: ${a.database}, no ORM.`);
  const t = [a.tests.runner, a.tests.e2e].filter(Boolean);
  if (t.length) out.push(`Tests: ${t.join(" + ")}.`);
  const l = [a.lint.eslint && "ESLint", a.lint.biome && "Biome", a.lint.prettier && "Prettier"]
    .filter(Boolean)
    .join(" + ");
  if (l) out.push(`Lint/format: ${l}.`);
  if (a.ci.length) out.push(`CI: ${a.ci.join(", ")}.`);
  if (a.envFiles.length) out.push(`Env files (names only): ${a.envFiles.join(", ")}.`);
  return out;
}

export interface AnalysisFindings {
  compatible: boolean;
  /** Blocking or approval-worthy differences, each with the decision taken. */
  conflicts: string[];
  /** Adaptation decisions with the reason (shown in the plan and written to the PR). */
  decisions: { topic: string; choice: string; why: string }[];
}

/** What the package needs from a project (from the package manifest / plan). */
export interface PackageNeeds {
  kind: "use_case" | "component";
  slug: string;
  usesDatabase: boolean;
  usesAuth: boolean;
  dependencies: Record<string, string>;
}

/** Compatibility, conflicts and adaptation decisions for one package in one analysed project. Deterministic. */
export function analysisFindings(a: RepoAnalysis, needs: PackageNeeds): AnalysisFindings {
  const conflicts: string[] = [];
  const decisions: AnalysisFindings["decisions"] = [];
  let compatible = true;
  const ns = namespaceDir(a, needs.slug);
  decisions.push({
    topic: "placement",
    choice: `\`${ns}/\``,
    why: `${a.sourceRoot ? "Your code lives under `src/`" : "Your code lives at the app root"}${a.monorepo ? ` of \`${a.appPath || "."}\`` : ""}: the capability gets its own folder there, so nothing of yours is overwritten and it can be removed in one step.`,
  });
  const alias = aliasFor(a, a.sourceRoot);
  decisions.push({
    topic: "imports",
    choice: alias ? `relative inside the capability, \`${alias}\` for your modules` : "relative",
    why: alias
      ? `Your project imports with \`${alias}\`; inside the capability folder imports stay relative so the folder is self-contained.`
      : "Your project has no import alias, so every import is relative.",
  });
  if (a.language === "other" || !a.framework.name) {
    if (a.language !== "typescript" && a.language !== "javascript") {
      compatible = false;
      conflicts.push(
        "No JavaScript/TypeScript application found: the capability is TypeScript. Use it as a separate service.",
      );
    }
  }
  if (a.language === "javascript")
    conflicts.push(
      "JavaScript project: the capability is TypeScript. Next.js compiles it as is; add a tsconfig.json to type-check it.",
    );
  if (needs.kind === "use_case" && a.framework.name && a.framework.name !== "nextjs") {
    compatible = false;
    conflicts.push(
      `${a.framework.name} project: this complete flow ships Next.js App Router routes. Its server modules can be reused; the pages need porting.`,
    );
  }
  const next = major(a.framework.version);
  if (a.framework.name === "nextjs" && Number.isFinite(next) && next < 15) {
    compatible = false;
    conflicts.push(
      `Next.js ${a.framework.version}: the capability targets Next.js 15+ (async request APIs). Upgrade Next.js first.`,
    );
  }
  if (a.framework.name === "nextjs" && a.framework.router === "pages" && needs.kind === "use_case")
    decisions.push({
      topic: "router",
      choice: "App Router routes next to your Pages Router",
      why: "Next.js runs both routers side by side; the capability's routes use the App Router and do not touch your pages.",
    });
  if (needs.usesDatabase) {
    if (a.database && a.database !== "postgres") {
      compatible = false;
      conflicts.push(
        `Your database is ${a.database}: the capability's tables are PostgreSQL. Use a PostgreSQL database for it.`,
      );
    } else if (a.orm.library === "drizzle") {
      decisions.push({
        topic: "database",
        choice: `reuse your Drizzle client${a.orm.clientModule ? ` (\`${a.orm.clientModule}\`)` : ""}`,
        why: "Same ORM and database: the capability's tables join your schema and its migration is generated with your drizzle-kit setup.",
      });
    } else if (a.orm.library === "prisma") {
      conflicts.push(
        "Prisma project: the capability's tables are defined with Drizzle. They are added as a separate module on the same DATABASE_URL with a SQL migration; Prisma does not manage them.",
      );
      decisions.push({
        topic: "database",
        choice: "own Drizzle module on your DATABASE_URL",
        why: "Rewriting verified tables into Prisma models would change tested code; both libraries share the PostgreSQL database safely.",
      });
    } else if (a.orm.library) {
      conflicts.push(
        `${a.orm.library} project: the capability's tables are added with their own Drizzle module on the same database.`,
      );
    } else {
      decisions.push({
        topic: "database",
        choice: "own Drizzle module on DATABASE_URL",
        why: "No database layer found: the capability brings a minimal one (drizzle-orm + pg) with a SQL migration.",
      });
    }
  }
  if (needs.usesAuth && a.auth.library && a.auth.library !== "better-auth") {
    conflicts.push(
      `Your project authenticates with ${a.auth.library}: keep it. The capability's session check is adapted to it (review the adapter in the pull request).`,
    );
    decisions.push({
      topic: "authentication",
      choice: `keep ${a.auth.library}`,
      why: "Two authentication systems in one app is a security risk; the capability calls yours through an adapter.",
    });
  } else if (needs.usesAuth && a.auth.library === "better-auth")
    decisions.push({
      topic: "authentication",
      choice: "reuse your better-auth setup",
      why: "Same library as the capability.",
    });
  // Dependencies: never downgrade, never change the project's versions.
  const deps = { ...a.versions };
  for (const [name, version] of Object.entries(needs.dependencies)) {
    const have = deps[name];
    if (have && major(have) !== major(version) && Number.isFinite(major(have)))
      conflicts.push(
        `${name}: verified with ${version}, your project has ${have}. Your version is kept (never downgraded); the verification in your project shows whether it works.`,
      );
  }
  if (a.tests.runner === "jest")
    decisions.push({
      topic: "tests",
      choice: "capability tests run with vitest, named *.vitest.ts",
      why: "Your suite runs Jest: the capability's vitest tests are named so Jest does not pick them up.",
    });
  return { compatible, conflicts, decisions };
}

/** The plan's view of a repository (shared contract `RepositoryFit`). */
export function repositoryFit(a: RepoAnalysis, needs: PackageNeeds): RepositoryFit {
  const f = analysisFindings(a, needs);
  return {
    repo: a.repo,
    ref: a.ref,
    appPath: a.appPath,
    stack: {
      language: a.language,
      framework: a.framework.name,
      version: a.framework.version,
      router: a.framework.router,
      packageManager: a.packageManager.name,
    },
    conventions: a.conventions,
    conflicts: f.conflicts,
    decisions: f.decisions,
    compatible: f.compatible,
    namespace: namespaceDir(a, needs.slug),
  };
}

/** Where the capability lives in the client's project, e.g. "apps/web/src/turbineh/ai-assistant". */
export function namespaceDir(a: Pick<RepoAnalysis, "appPath" | "sourceRoot">, slug: string) {
  return join(a.appPath, a.sourceRoot, "turbineh", slug);
}
