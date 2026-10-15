/**
 * Repository fixtures modelled on real project layouts (create-next-app, create-t3-app, a Pages Router app and a
 * turborepo). Each is a file list plus the contents the analysis is allowed to read. Env files appear by name only:
 * their "content" is a canary that must never be read or copied.
 */
export interface RepoFixture {
  name: string;
  paths: string[];
  files: Record<string, string>;
}

export const SECRET_CANARY = "sk_live_CANARY_must_never_be_read";

const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;

/** create-next-app (Next 16, App Router, src/, Tailwind 4) + Drizzle + better-auth + vitest, pnpm. */
export const appRouterSrc: RepoFixture = {
  name: "app-router-src",
  paths: [
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "next.config.ts",
    "postcss.config.mjs",
    "eslint.config.mjs",
    ".prettierrc",
    "drizzle.config.ts",
    "drizzle/0000_init.sql",
    "drizzle/meta/_journal.json",
    "vitest.config.ts",
    ".env.example",
    ".env.local",
    ".github/workflows/ci.yml",
    "components.json",
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/globals.css",
    "src/app/api/auth/[...all]/route.ts",
    "src/db/index.ts",
    "src/db/schema.ts",
    "src/lib/auth.ts",
    "src/lib/utils.ts",
    "src/components/ui/button.tsx",
    "src/lib/utils.test.ts",
  ],
  files: {
    "package.json": json({
      name: "acme-web",
      private: true,
      type: "module",
      packageManager: "pnpm@10.33.0",
      scripts: {
        dev: "next dev",
        build: "next build",
        lint: "eslint .",
        typecheck: "tsc --noEmit",
        test: "vitest run",
        "db:generate": "drizzle-kit generate",
      },
      dependencies: {
        "better-auth": "1.7.6",
        "drizzle-orm": "0.45.3",
        next: "16.3.8",
        pg: "8.23.0",
        react: "19.3.0",
        "react-dom": "19.3.0",
        "@radix-ui/react-slot": "1.2.4",
      },
      devDependencies: {
        "@types/node": "24.19.0",
        "@types/pg": "8.23.1",
        "drizzle-kit": "0.31.11",
        eslint: "10.11.0",
        prettier: "3.6.2",
        tailwindcss: "4.3.3",
        typescript: "6.0.3",
        vitest: "5.0.2",
      },
    }),
    "tsconfig.json": `{
  // create-next-app defaults
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./src/*"] },
  },
}
`,
    "next.config.ts": "export default {};\n",
    "drizzle.config.ts": `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
`,
    "src/db/index.ts": `import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
export const db = drizzle(process.env.DATABASE_URL!, { schema });
`,
    "src/db/schema.ts": `import { pgTable, text } from "drizzle-orm/pg-core";
export const notes = pgTable("notes", { id: text("id").primaryKey() });
`,
    ".env.example": "DATABASE_URL=\nBETTER_AUTH_SECRET=\n",
    ".env.local": `STRIPE_SECRET_KEY=${SECRET_CANARY}\n`,
    "components.json": "{}\n",
    "vitest.config.ts": "export default {};\n",
  },
};

/** create-t3-app style without src/ (App Router at the root), npm, Prisma, NextAuth, Jest. */
export const appRouterRoot: RepoFixture = {
  name: "app-router-root",
  paths: [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next.config.mjs",
    "jest.config.js",
    ".eslintrc.json",
    "prisma/schema.prisma",
    "prisma/migrations/20260101000000_init/migration.sql",
    "app/layout.tsx",
    "app/page.tsx",
    "app/api/auth/[...nextauth]/route.ts",
    "lib/prisma.ts",
    ".env",
    ".env.example",
  ],
  files: {
    "package.json": json({
      name: "t3-shop",
      private: true,
      scripts: { dev: "next dev", build: "next build", lint: "next lint", test: "jest" },
      dependencies: {
        next: "15.5.4",
        react: "19.1.0",
        "react-dom": "19.1.0",
        "next-auth": "4.24.11",
        "@prisma/client": "6.16.2",
        zod: "3.25.76",
      },
      devDependencies: {
        typescript: "5.9.2",
        jest: "30.1.3",
        prisma: "6.16.2",
        eslint: "9.36.0",
      },
    }),
    "tsconfig.json": json({ compilerOptions: { strict: true, paths: { "@/*": ["./*"] } } }),
    "next.config.mjs": "export default {};\n",
    "prisma/schema.prisma": `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`,
    ".env": `DATABASE_URL=postgres://prod:${SECRET_CANARY}@db/prod\n`,
    ".env.example": "DATABASE_URL=\nNEXTAUTH_SECRET=\n",
  },
};

/** Pages Router app (Next 15, pages/ at the root, no alias, no ORM), yarn. */
export const pagesRouter: RepoFixture = {
  name: "pages-router",
  paths: [
    "package.json",
    "yarn.lock",
    "tsconfig.json",
    "next.config.js",
    "pages/_app.tsx",
    "pages/index.tsx",
    "pages/api/hello.ts",
    "styles/globals.css",
    "tailwind.config.js",
  ],
  files: {
    "package.json": json({
      name: "marketing",
      scripts: { dev: "next dev", build: "next build", lint: "next lint" },
      dependencies: { next: "15.2.0", react: "19.0.0", "react-dom": "19.0.0" },
      devDependencies: { typescript: "5.8.3", tailwindcss: "3.4.17", "@types/node": "22.10.0" },
    }),
    "tsconfig.json": json({ compilerOptions: { strict: false } }),
    "next.config.js": "module.exports = {};\n",
  },
};

/** Turborepo with two Next apps and shared packages; the product app is apps/web (alias ~/). */
export const monorepo: RepoFixture = {
  name: "monorepo",
  paths: [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "turbo.json",
    ".github/workflows/ci.yml",
    "apps/web/package.json",
    "apps/web/tsconfig.json",
    "apps/web/next.config.ts",
    "apps/web/src/app/layout.tsx",
    "apps/web/src/app/(dashboard)/page.tsx",
    "apps/web/src/server/db.ts",
    "apps/web/drizzle.config.ts",
    "apps/web/.env.example",
    "apps/docs/package.json",
    "apps/docs/app/page.tsx",
    "packages/ui/package.json",
    "packages/ui/src/button.tsx",
    "packages/config/package.json",
  ],
  files: {
    "package.json": json({
      name: "acme",
      private: true,
      packageManager: "pnpm@10.33.0",
      devDependencies: { turbo: "2.5.8", prettier: "3.6.2" },
    }),
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
    "apps/web/package.json": json({
      name: "web",
      type: "module",
      scripts: { build: "next build", lint: "eslint .", typecheck: "tsc --noEmit" },
      dependencies: {
        next: "16.3.8",
        react: "19.3.0",
        "drizzle-orm": "0.45.3",
        postgres: "3.4.7",
        zod: "4.6.5",
        "@clerk/nextjs": "6.33.0",
      },
      devDependencies: { typescript: "6.0.3", "drizzle-kit": "0.31.11", eslint: "10.11.0" },
    }),
    "apps/web/tsconfig.json": json({
      compilerOptions: { strict: true, paths: { "~/*": ["./src/*"] } },
    }),
    "apps/web/next.config.ts": "export default {};\n",
    "apps/web/drizzle.config.ts": `export default { dialect: "postgresql", schema: "./src/server/schema/*.ts", out: "./migrations" };\n`,
    "apps/web/src/server/db.ts": `import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
export function getDb() {
  return drizzle(postgres(process.env.DATABASE_URL ?? ""));
}
`,
    "apps/web/.env.example": "DATABASE_URL=\nCLERK_SECRET_KEY=\n",
    "apps/docs/package.json": json({ name: "docs", dependencies: { next: "16.3.8" } }),
    "packages/ui/package.json": json({ name: "@acme/ui" }),
    "packages/config/package.json": json({ name: "@acme/config" }),
  },
};

export const FIXTURES = [appRouterSrc, appRouterRoot, pagesRouter, monorepo];

/** What the analysis would get through the API: only the files it asks for, minus anything not readable. */
export function readable(f: RepoFixture, wanted: string[], isReadable: (p: string) => boolean) {
  return Object.fromEntries(
    wanted.filter((p) => isReadable(p) && p in f.files).map((p) => [p, f.files[p] ?? ""]),
  );
}
