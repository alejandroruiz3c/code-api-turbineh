import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adaptPackage,
  drizzleExport,
  importsOf,
  loadFoundation,
  mergeEnvExample,
  mergePackageJson,
  rewriteImports,
} from "./adapt.js";
import { github } from "./github.js";
import { writeComponentPackage, type PackageInfo } from "./package.js";
import { prBody } from "./pr-body.js";
import {
  analyseRepo,
  analysisFindings,
  firstReadList,
  isReadable,
  pickAppPath,
  secondReadList,
  type RepoAnalysis,
} from "./repo-analysis.js";
import {
  appRouterRoot,
  appRouterSrc,
  FIXTURES,
  monorepo,
  pagesRouter,
  readable,
  SECRET_CANARY,
  type RepoFixture,
} from "./repos.fixtures.js";
import { zipDirectory } from "./zip.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The analysis exactly as the API runs it: two reads, each limited to what it asks for. */
function analyse(f: RepoFixture): RepoAnalysis {
  const first = readable(f, firstReadList(f.paths), isReadable);
  const appPath = pickAppPath(first);
  const second = readable(f, secondReadList(f.paths, appPath, first), isReadable);
  return analyseRepo({
    repo: `acme/${f.name}`,
    ref: "main",
    paths: f.paths,
    files: { ...first, ...second },
    appPath,
  });
}

describe("repository analysis on real layouts", () => {
  it("App Router with src/: alias, Drizzle client, better-auth, vitest, pnpm, CI, env names only", () => {
    const a = analyse(appRouterSrc);
    expect(a.appPath).toBe("");
    expect(a.framework).toMatchObject({
      name: "nextjs",
      version: "16.3.8",
      router: "app",
      appDir: "src/app",
    });
    expect(a.sourceRoot).toBe("src");
    expect(a.typescript.aliases).toEqual({ "@/*": ["./src/*"] });
    expect(a.typescript.strict).toBe(true);
    expect(a.orm).toMatchObject({
      library: "drizzle",
      schema: "./src/db/schema.ts",
      migrationsDir: "drizzle",
      clientModule: "src/db/index.ts",
    });
    expect(a.database).toBe("postgres");
    expect(a.auth.library).toBe("better-auth");
    expect(a.packageManager).toEqual({ name: "pnpm", lockfile: "pnpm-lock.yaml" });
    expect(a.tests.runner).toBe("vitest");
    expect(a.styling.tailwind).toBe("4.3.3");
    expect(a.styling.ui).toEqual(["shadcn/ui", "Radix UI"]);
    expect(a.lint).toEqual({ eslint: true, biome: false, prettier: true });
    expect(a.ci).toEqual([".github/workflows/ci.yml"]);
    expect(a.envFiles).toEqual([".env.example", ".env.local"]);
    expect(a.conventions.join(" ")).toContain("Import alias `@/` → `src/`");
    expect(JSON.stringify(a)).not.toContain(SECRET_CANARY);
  });

  it("App Router without src/: root alias, Prisma, NextAuth, Jest, npm", () => {
    const a = analyse(appRouterRoot);
    expect(a.framework.router).toBe("app");
    expect(a.framework.appDir).toBe("app");
    expect(a.sourceRoot).toBe("");
    expect(a.orm).toMatchObject({
      library: "prisma",
      schema: "prisma/schema.prisma",
      migrationsDir: "prisma/migrations",
    });
    expect(a.database).toBe("postgres");
    expect(a.auth.library).toBe("next-auth");
    expect(a.tests.runner).toBe("jest");
    expect(a.packageManager.name).toBe("npm");
    expect(a.conventions.join(" ")).toContain("Code lives at the app root");
    expect(JSON.stringify(a)).not.toContain(SECRET_CANARY);
  });

  it("Pages Router: no alias, no ORM, yarn, Tailwind 3", () => {
    const a = analyse(pagesRouter);
    expect(a.framework).toMatchObject({ router: "pages", pagesDir: "pages", version: "15.2.0" });
    expect(a.sourceRoot).toBe("");
    expect(a.typescript.aliases).toEqual({});
    expect(a.orm.library).toBeNull();
    expect(a.packageManager.name).toBe("yarn");
    expect(a.styling.tailwind).toBe("3.4.17");
    expect(a.conventions.join(" ")).toContain("No import alias");
  });

  it("monorepo: picks apps/web, its alias and its Drizzle client module", () => {
    const a = analyse(monorepo);
    expect(a.appPath).toBe("apps/web");
    expect(a.monorepo).toMatchObject({ tool: "turborepo" });
    expect(a.monorepo?.apps).toEqual(["apps/docs", "apps/web"]);
    expect(a.framework.appDir).toBe("src/app");
    expect(a.sourceRoot).toBe("src");
    expect(a.typescript.aliases).toEqual({ "~/*": ["./src/*"] });
    expect(a.orm.clientModule).toBe("src/server/db.ts");
    expect(a.orm.schema).toBe("./src/server/schema/*.ts");
    expect(a.auth.library).toBe("@clerk/nextjs");
    expect(a.packageManager.name).toBe("pnpm");
    expect(a.envExample).toBe("apps/web/.env.example");
  });

  it("never asks for env files, keys or build output", () => {
    for (const f of FIXTURES) {
      const first = readable(f, firstReadList(f.paths), isReadable);
      const wanted = [
        ...firstReadList(f.paths),
        ...secondReadList(f.paths, pickAppPath(first), first),
      ];
      expect(wanted.filter((p) => /(^|\/)\.env(\.|$)/.test(p) && !/example/.test(p))).toEqual([]);
    }
    for (const p of [".env", ".env.local", "apps/web/.env.production", "certs/key.pem", ".npmrc"])
      expect(isReadable(p), p).toBe(false);
    expect(isReadable(".env.example")).toBe(true); // names of settings, no values
  });

  it("findings: conflicts and decisions with reasons", () => {
    const needs = {
      kind: "component" as const,
      slug: "ai-assistant",
      usesDatabase: true,
      usesAuth: true,
      dependencies: { zod: "4.6.5" },
    };
    const t3 = analysisFindings(analyse(appRouterRoot), needs);
    expect(t3.compatible).toBe(true);
    expect(t3.conflicts.join(" ")).toMatch(/Prisma/);
    expect(t3.conflicts.join(" ")).toMatch(/next-auth: keep it|authenticates with next-auth/);
    expect(t3.conflicts.join(" ")).toMatch(/zod: verified with 4.6.5, your project has 3.25.76/);
    const src = analysisFindings(analyse(appRouterSrc), needs);
    expect(src.decisions.find((d) => d.topic === "database")?.choice).toMatch(
      /reuse your Drizzle client/,
    );
    const old = analyseRepo({
      repo: "a/b",
      ref: "main",
      paths: ["package.json", "app/page.tsx"],
      files: { "package.json": JSON.stringify({ dependencies: { next: "14.2.0", mysql2: "3" } }) },
    });
    const f = analysisFindings(old, needs);
    expect(f.compatible).toBe(false);
    expect(f.conflicts.join(" ")).toMatch(/Next.js 14.2.0/);
    expect(f.conflicts.join(" ")).toMatch(/mysql/);
  });
});

// ── adaptation ────────────────────────────────────────────────────────────────────────────────────────────

const info: PackageInfo = {
  slug: "ai-assistant",
  name: "AI assistant",
  need: "An AI assistant that answers from our help centre",
  planId: "11111111-2222-3333-4444-555555555555",
  state: "verified",
  summary: "AI assistant",
  components: [],
  checks: [{ name: "certification", ok: true }],
};

/** The real component package (AI orchestrator + AI Safety Pack), as the worker builds it. */
function realPackage(): Buffer {
  const out = mkdtempSync(join(tmpdir(), "pkg-"));
  const dir = writeComponentPackage(
    ["ai.orchestrator.turbineh", "security.ai-safety.turbineh"].map((id) => ({
      id,
      version: "0.1.0",
      license: "Apache-2.0",
      purl: `pkg:generic/turbineh/${id}@0.1.0`,
      capability: id,
      dir: join(root, "catalog/components", id),
      does: id,
    })),
    out,
    info,
  );
  return zipDirectory(dir, info.slug);
}

const base = loadFoundation(join(root, "catalog/recipes/saas-crud/template"));
const adapt = (f: RepoFixture, extra: Record<string, string> = {}) => {
  const all = { ...f.files, ...extra };
  return adaptPackage({
    zip: realPackage(),
    analysis: analyse(f),
    read: (p) => (isReadable(p) || /\.env\.(example|sample)$/.test(p) ? (all[p] ?? null) : null),
    foundation: base.foundation,
    versions: base.versions,
    planId: info.planId,
    need: info.need,
  });
};
const files = (x: ReturnType<typeof adapt>) => x.steps.flatMap((s) => s.files);
const text = (x: ReturnType<typeof adapt>, p: string) =>
  String(files(x).find((f) => f.path === p)?.content ?? "");

describe("adaptation to the client's conventions", () => {
  it("App Router + src/ + Drizzle: own folder, relative imports, reuses the client's db, one line in the schema", () => {
    const x = adapt(appRouterSrc);
    const ns = "src/turbineh/ai-assistant";
    expect(x.namespace).toBe(ns);
    const paths = files(x).map((f) => f.path);
    // Unrelated files are never touched: every change is in the namespace or one of three integration points.
    expect(paths.filter((p) => !p.startsWith(`${ns}/`)).sort()).toEqual([
      ".env.example",
      "package.json",
      "src/db/schema.ts",
    ]);
    expect(files(x).find((f) => f.path === "src/db/schema.ts")?.action).toBe("modify");
    const orchestrator = text(x, `${ns}/lib/ai/orchestrator.ts`);
    expect(orchestrator).not.toMatch(/from "@\//);
    expect(importsOf(orchestrator)).toContain("../../db/client");
    expect(text(x, `${ns}/db/client.ts`)).toContain('export { db } from "@/db";');
    expect(text(x, `${ns}/security/errors.ts`)).toContain("UserFacingError");
    expect(text(x, "src/db/schema.ts")).toContain(
      'export * from "../turbineh/ai-assistant/db/schema"; // turbineh: ai-assistant tables',
    );
    expect(
      text(x, "src/db/schema.ts").startsWith(appRouterSrc.files["src/db/schema.ts"] ?? ""),
    ).toBe(true);
    expect(x.migration).toMatchObject({ kind: "drizzle-kit", dir: "drizzle" });
    // zod is imported by the components and missing in this project: added with the verified exact version.
    expect(x.dependencies.added).toContain("zod@4.6.5");
    expect(x.dependencies.added.some((d) => d.startsWith("vitest"))).toBe(false);
    expect(text(x, ".env.example")).toContain("TURBINEH_AI_TOKEN=");
    expect(text(x, ".env.example")).not.toMatch(/TURBINEH_AI_URL=\S/);
    // Exactly what is left for the reviewer: one required setting; the rest keep documented defaults.
    const setup = x.reviewerSetup.join("\n");
    expect(setup).toMatch(/Set this setting in each environment .*`TURBINEH_AI_TOKEN`/);
    expect(setup).toMatch(/Optional, nothing to do .*`AI_ROUTES`/);
    expect(setup).toMatch(
      /run `pnpm install` \(this pull request already updates `pnpm-lock.yaml`\)/,
    );
    expect(setup).toContain("`src/turbineh/ai-assistant/lib/ai/orchestrator.ts`");
    expect(text(x, ".env.example")).toContain("# default: https://software.turbineh.com/v1/ai");
    expect(x.steps.map((s) => s.key)).toEqual([
      "code",
      "glue",
      "database",
      "dependencies",
      "settings",
    ]);
    expect(x.tests.runInProjectSuite).toBe(true);
    for (const f of files(x)) expect(String(f.content)).not.toContain(SECRET_CANARY);
  });

  it("no src/ + Prisma + Jest: own Drizzle client, SQL migration, vitest added, tests renamed for Jest", () => {
    const x = adapt(appRouterRoot);
    const ns = "turbineh/ai-assistant";
    expect(x.namespace).toBe(ns);
    expect(text(x, `${ns}/db/client.ts`)).toContain("process.env.DATABASE_URL");
    expect(x.migration).toMatchObject({ kind: "sql", dir: `${ns}/db/migrations` });
    expect(files(x).some((f) => f.path.endsWith(".vitest.ts"))).toBe(true);
    expect(files(x).some((f) => /tests\/.*\.test\.ts$/.test(f.path))).toBe(false);
    expect(x.dependencies.added).toEqual(
      expect.arrayContaining(["drizzle-orm@0.45.3", "pg@8.23.0", "vitest@5.0.2 (dev)"]),
    );
    // zod 3 is kept (never changed), and the difference is stated.
    expect(x.dependencies.kept).toContain("zod");
    expect(x.dependencies.conflicts.join(" ")).toMatch(/zod/);
    expect(x.findings.conflicts.join(" ")).toMatch(/Prisma/);
    expect(x.reviewerSetup.join(" ")).toMatch(/Prisma does not manage these tables/);
    const pkg = JSON.parse(text(x, "package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.next).toBe("15.5.4");
    // The project's order is kept (not sorted here, so new entries are appended).
    expect(Object.keys(pkg.dependencies).slice(0, 6)).toEqual([
      "next",
      "react",
      "react-dom",
      "next-auth",
      "@prisma/client",
      "zod",
    ]);
  });

  it("monorepo: everything under apps/web, glue requested from the model for a factory-style client", () => {
    const x = adapt(monorepo);
    const ns = "apps/web/src/turbineh/ai-assistant";
    expect(x.namespace).toBe(ns);
    expect(files(x).every((f) => f.path.startsWith("apps/web/"))).toBe(true);
    expect(x.glue).toHaveLength(1);
    expect(x.glue[0]?.path).toBe(`${ns}/db/client.ts`);
    expect(x.glue[0]?.context["src/server/db.ts"]).toContain("getDb");
    expect(x.glue[0]?.fallback).toContain("process.env.DATABASE_URL");
    expect(x.migration.kind).toBe("sql");
    expect(x.limits.join(" ")).toMatch(/not a single file/);
  });

  it("Pages Router: components land next to pages without touching them", () => {
    const x = adapt(pagesRouter);
    expect(files(x).some((f) => f.path.startsWith("pages/"))).toBe(false);
    expect(x.namespace).toBe("turbineh/ai-assistant");
  });

  it("merges package.json and .env.example without downgrades or values", () => {
    const before = `{\n\t"name": "x",\n\t"dependencies": {\n\t\t"a": "1.0.0",\n\t\t"zod": "^3.22.0"\n\t}\n}\n`;
    const m = mergePackageJson(before, [
      { name: "zod", version: "4.6.5", dev: false },
      { name: "b", version: "^2.1.0", dev: false },
      { name: "vitest", version: "5.0.2", dev: true },
    ]);
    const pkg = JSON.parse(m.text) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({ a: "1.0.0", b: "2.1.0", zod: "^3.22.0" });
    expect(pkg.devDependencies).toEqual({ vitest: "5.0.2" });
    expect(m.text).toContain('\t"name"');
    expect(m.kept).toEqual(["zod"]);
    const e = mergeEnvExample("A=1\nexport B=\n", ["A", "B", "C"], "cap");
    expect(e.added).toEqual(["C"]);
    expect(e.text).toBe("A=1\nexport B=\n\n# cap\nC=\n");
  });

  it("finds the exported Drizzle client and rewrites only module specifiers", () => {
    expect(drizzleExport("export const database = drizzle(pool);")).toBe("database");
    expect(drizzleExport("const db = drizzle(x);\nexport { db };")).toBe("db");
    expect(drizzleExport("export function getDb() { return drizzle(x) }")).toBeNull();
    const code = `import a from "@/x";\nexport * from "@/y";\nconst m = await import("@/z");\nconst s = "@/not-an-import";`;
    expect(rewriteImports(code, (s) => (s.startsWith("@/") ? `./${s.slice(2)}` : null))).toBe(
      `import a from "./x";\nexport * from "./y";\nconst m = await import("./z");\nconst s = "@/not-an-import";`,
    );
  });
});

describe("pull request composition", () => {
  it("has summary, files, decisions, verification, limits, setup and revert; no vendor names", () => {
    const x = adapt(appRouterSrc);
    const body = prBody({
      need: info.need,
      planId: info.planId,
      adaptation: x,
      analysis: analyse(appRouterSrc),
      commits: [{ sha: "abcdef1234567890", message: x.steps[0]?.message ?? "" }],
      verification: {
        state: "failed",
        seconds: 95,
        checks: [
          { name: "install", ok: true, detail: "pnpm install --frozen-lockfile" },
          {
            name: "typecheck",
            ok: false,
            detail: "src/turbineh/ai-assistant/db/client.ts(2,10): error TS2305",
            action: "Fix the export",
          },
          { name: "e2e", ok: null, detail: "no script" },
        ],
      },
      glue: [],
    });
    for (const h of [
      "## Summary",
      "## Your project, as analysed",
      "## Decisions and why",
      "## Files",
      "## Commits (one per logical step)",
      "## Verification in your project",
      "### What failed and what to do",
      "### Limits",
      "## What you must configure",
      "## How to revert",
    ])
      expect(body).toContain(h);
    expect(body).toContain("| modified | `src/db/schema.ts` |");
    expect(body).toContain("stays a draft");
    expect(body).toContain("**typecheck**");
    expect(body).not.toMatch(/JEV|TypeSafe|Quyet|SystemOne|DeepSeek|GLM|Scaleway/);
  });
});

describe("GitHub client", () => {
  it("sends the token only as a header and maps errors to actionable ones without echoing it", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const token = "gho_example_token_never_echoed_0000";
    const gh = github(token, (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
    }) as typeof fetch);
    await expect(gh("GET", "/user")).rejects.toMatchObject({
      status: 401,
      action: expect.stringMatching(/Connect GitHub again/),
    });
    await gh("GET", "/user").catch((e: Error) => expect(e.message).not.toContain(token));
    expect(seen[0]?.url).not.toContain(token);
    expect(seen[0]?.auth).toBe(`Bearer ${token}`);
  });
});
