/**
 * Adaptation decisions of the GitHub integration (ADR-0034) — code vs decider, on 20 labelled repositories (ADR-0039).
 * Three decisions per repository: which app of the project receives the capability, the database strategy and the
 * authentication strategy. "code" is the engine's deterministic analysis (pickAppPath + analysisFindings, what runs
 * today); "decider" asks the configured decider (primary + fallback, as selection) one batched request per repository
 * with the same facts. Labels follow the integration policy of ADR-0034 and, for placement, the app that already has
 * what the capability reuses (database and sign-in).
 *
 *   pnpm --filter @turbineh/bench exec tsx agent-decisions/adaptation.ts [--label name]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { choice, deciderFromEnv } from "@turbineh/decider";
import {
  analyseRepo,
  analysisFindings,
  chooseAppPath,
  pickAppPath,
  type AppChoiceDecider,
  type PackageNeeds,
} from "@turbineh/engine";
import { loadLocalEnv, readEnv } from "@turbineh/shared";

const root = join(import.meta.dirname, "../..");
const LABEL = process.argv.includes("--label")
  ? (process.argv[process.argv.indexOf("--label") + 1] ?? "run")
  : "run";
const DECIDER_PRICE = 0.42; // $/MTok [est.], as bench/frontiers/brain.ts
/** The person's need as the plans API passes it to chooseAppPath. */
const NEED_TEXT =
  "An AI booking assistant for a physiotherapy clinic: patients chat to check availability, book, reschedule and cancel; staff sign in to manage the bookings.";

type Deps = Record<string, string>;
interface Case {
  id: string;
  /** package.json dependencies per package dir ("" = root). */
  packages: Record<string, Deps>;
  expected: { app: string; database: string; auth: string };
}

const NEXT = { next: "16.0.1", react: "19.2.0" };
const DRIZZLE_PG = { "drizzle-orm": "0.45.0", pg: "8.16.0" };
const BA = { "better-auth": "1.3.0" };

const CASES: Case[] = [
  // Placement (the database and auth labels follow from the chosen app).
  {
    id: "p1-root-app",
    packages: { "": { ...NEXT, ...DRIZZLE_PG, ...BA } },
    expected: { app: "", database: "reuse", auth: "reuse" },
  },
  {
    id: "p2-apps-web-only",
    packages: {
      "": {},
      "apps/web": { ...NEXT, ...DRIZZLE_PG, ...BA },
      "packages/ui": { react: "19.2.0" },
    },
    expected: { app: "apps/web", database: "reuse", auth: "reuse" },
  },
  {
    id: "p3-marketing-web-product-app",
    packages: { "": {}, "apps/web": { ...NEXT }, "apps/app": { ...NEXT, ...DRIZZLE_PG, ...BA } },
    expected: { app: "apps/app", database: "reuse", auth: "reuse" },
  },
  {
    id: "p4-site-and-dashboard",
    packages: {
      "": {},
      "apps/site": { ...NEXT },
      "apps/dashboard": {
        ...NEXT,
        "@prisma/client": "6.1.0",
        "next-auth": "4.24.11",
        pg: "8.16.0",
      },
    },
    expected: { app: "apps/dashboard", database: "own", auth: "adapter" },
  },
  {
    id: "p5-docs-and-web",
    packages: {
      "": {},
      "apps/docs": { ...NEXT, nextra: "4.2.0" },
      "apps/web": { ...NEXT, ...DRIZZLE_PG },
    },
    expected: { app: "apps/web", database: "reuse", auth: "own" },
  },
  {
    id: "p6-api-and-web",
    packages: {
      "": {},
      "apps/api": { express: "5.1.0", ...DRIZZLE_PG },
      "apps/web": { ...NEXT, ...BA },
    },
    expected: { app: "apps/web", database: "own", auth: "reuse" },
  },
  {
    id: "p7-blog-and-storefront",
    packages: {
      "": {},
      "apps/blog": { ...NEXT },
      "apps/storefront": { ...NEXT, ...DRIZZLE_PG, ...BA },
    },
    expected: { app: "apps/storefront", database: "reuse", auth: "reuse" },
  },
  {
    id: "p8-root-next-with-packages",
    packages: { "": { ...NEXT, ...BA }, "packages/config": {} },
    expected: { app: "", database: "own", auth: "reuse" },
  },
  // Database strategy.
  {
    id: "d1-prisma-postgres",
    packages: { "": { ...NEXT, "@prisma/client": "6.1.0", pg: "8.16.0", ...BA } },
    expected: { app: "", database: "own", auth: "reuse" },
  },
  {
    id: "d2-drizzle-mysql",
    packages: { "": { ...NEXT, "drizzle-orm": "0.45.0", mysql2: "3.14.0", ...BA } },
    expected: { app: "", database: "incompatible", auth: "reuse" },
  },
  {
    id: "d3-mongoose",
    packages: { "": { ...NEXT, mongoose: "8.9.0", ...BA } },
    expected: { app: "", database: "incompatible", auth: "reuse" },
  },
  {
    id: "d4-kysely-postgres",
    packages: { "": { ...NEXT, kysely: "0.28.0", pg: "8.16.0", ...BA } },
    expected: { app: "", database: "own", auth: "reuse" },
  },
  {
    id: "d5-no-database",
    packages: { "": { ...NEXT, ...BA } },
    expected: { app: "", database: "own", auth: "reuse" },
  },
  {
    id: "d6-drizzle-neon",
    packages: {
      "": { ...NEXT, "drizzle-orm": "0.45.0", "@neondatabase/serverless": "1.0.0", ...BA },
    },
    expected: { app: "", database: "reuse", auth: "reuse" },
  },
  // Authentication strategy.
  {
    id: "a1-next-auth",
    packages: { "": { ...NEXT, ...DRIZZLE_PG, "next-auth": "4.24.11" } },
    expected: { app: "", database: "reuse", auth: "adapter" },
  },
  {
    id: "a2-clerk",
    packages: { "": { ...NEXT, ...DRIZZLE_PG, "@clerk/nextjs": "6.12.0" } },
    expected: { app: "", database: "reuse", auth: "adapter" },
  },
  {
    id: "a3-supabase",
    packages: { "": { ...NEXT, ...DRIZZLE_PG, "@supabase/ssr": "0.6.0" } },
    expected: { app: "", database: "reuse", auth: "adapter" },
  },
  {
    id: "a4-no-auth",
    packages: { "": { ...NEXT, ...DRIZZLE_PG } },
    expected: { app: "", database: "reuse", auth: "own" },
  },
  {
    id: "a5-lucia",
    packages: { "": { ...NEXT, ...DRIZZLE_PG, lucia: "3.2.2" } },
    expected: { app: "", database: "reuse", auth: "adapter" },
  },
  {
    id: "a6-workos",
    packages: { "": { ...NEXT, "@workos-inc/authkit-nextjs": "2.1.0" } },
    expected: { app: "", database: "own", auth: "adapter" },
  },
];

const NEEDS: PackageNeeds = {
  kind: "use_case",
  slug: "booking-assistant",
  usesDatabase: true,
  usesAuth: true,
  dependencies: { "drizzle-orm": "0.45.0", "better-auth": "1.3.0" },
};

function repoOf(c: Case) {
  const files: Record<string, string> = {};
  const paths: string[] = [];
  for (const [dir, deps] of Object.entries(c.packages)) {
    const p = dir ? `${dir}/package.json` : "package.json";
    files[p] = JSON.stringify({ name: dir || "root", dependencies: deps });
    paths.push(p);
    if ("next" in deps) paths.push(dir ? `${dir}/src/app/page.tsx` : "src/app/page.tsx");
  }
  if (Object.keys(c.packages).length > 1) {
    files["pnpm-workspace.yaml"] = "packages:\n  - apps/*\n  - packages/*\n";
    paths.push("pnpm-workspace.yaml");
  }
  paths.push("tsconfig.json");
  files["tsconfig.json"] = JSON.stringify({ compilerOptions: { strict: true } });
  return { files, paths };
}

/** The code path that runs today, mapped onto the three options. */
function codeDecision(c: Case, appPath?: string) {
  const { files, paths } = repoOf(c);
  const app = appPath ?? pickAppPath(files);
  const a = analyseRepo({ repo: c.id, ref: "main", paths, files, appPath: app });
  const f = analysisFindings(a, NEEDS);
  const db = f.decisions.find((d) => d.topic === "database")?.choice ?? "";
  const auth = f.decisions.find((d) => d.topic === "authentication")?.choice ?? "";
  return {
    app,
    database: f.conflicts.some((x) => /Your database is/.test(x))
      ? "incompatible"
      : /^reuse/.test(db)
        ? "reuse"
        : "own",
    auth: /^reuse/.test(auth) ? "reuse" : /^keep/.test(auth) ? "adapter" : "own",
  };
}

loadLocalEnv(root);
const decider = deciderFromEnv(readEnv());

/**
 * What ships (ADR-0039 amendment): the app from `chooseAppPath` (decider when there are several apps, heuristic
 * fallback), database and auth from code on that app. Decider tokens are metered through a wrapper.
 */
let shippedTokens = 0;
const metered: AppChoiceDecider = {
  ask: (async (
    state: Parameters<typeof decider.ask>[0],
    questions: Parameters<typeof decider.ask>[1],
  ) => {
    const d = await decider.ask(state, questions);
    shippedTokens += (d.meta.usage.input_tokens ?? 0) + (d.meta.usage.output_tokens ?? 0);
    return d;
  }) as AppChoiceDecider["ask"],
};
async function shippedDecision(c: Case) {
  const t0 = performance.now();
  const choice = await chooseAppPath(repoOf(c).files, { decider: metered, need: NEED_TEXT });
  const ms = performance.now() - t0;
  return { decision: codeDecision(c, choice.appPath), by: choice.by, ms };
}

async function deciderDecision(c: Case) {
  const apps = Object.entries(c.packages).map(([dir, deps]) => ({
    dir: dir || "(repository root)",
    dependencies: Object.keys(deps),
  }));
  const d = await decider.ask(
    {
      capability:
        "A customer-facing AI booking assistant (Next.js App Router pages and server code) that stores bookings in PostgreSQL tables defined with Drizzle and checks the signed-in staff session.",
      project_packages: apps,
    },
    {
      // A Choice needs two options: a single-package repository has nothing to decide.
      ...(Object.keys(c.packages).length > 1
        ? {
            app: choice(
              "Which package of the project should receive the capability?",
              Object.fromEntries(
                Object.keys(c.packages).map((dir) => [
                  dir || "root",
                  `The package at ${dir || "the repository root"}.`,
                ]),
              ),
              { includeNone: false },
            ),
          }
        : {}),
      database: choice(
        "How should the capability store its tables in the package you chose?",
        {
          reuse: "Reuse the project's existing Drizzle client on its PostgreSQL database.",
          own: "Add the capability's own small Drizzle module on the project's PostgreSQL DATABASE_URL (the project uses another library, or has no database layer yet).",
          incompatible:
            "The project's database is not PostgreSQL: the capability cannot store its tables there.",
        },
        { includeNone: false },
      ),
      auth: choice(
        "How should the capability check who is signed in?",
        {
          reuse: "Reuse the project's better-auth setup (same library as the capability).",
          adapter: "Keep the project's own sign-in library and call it through a small adapter.",
          own: "The project has no sign-in yet: the capability brings its own (better-auth).",
        },
        { includeNone: false },
      ),
    },
  );
  const pick = (k: string) => {
    const a = (d.answers as Record<string, { type: string; choice?: string } | undefined>)[k];
    return a?.type === "choice" ? (a.choice ?? "") : "";
  };
  const only = Object.keys(c.packages).length === 1 ? (Object.keys(c.packages)[0] ?? "") : null;
  return {
    decision: {
      app: only ?? (pick("app") === "root" ? "" : pick("app")),
      database: pick("database"),
      auth: pick("auth"),
    },
    latencyMs: d.meta.latencyMs,
    tokens: (d.meta.usage.input_tokens ?? 0) + (d.meta.usage.output_tokens ?? 0),
    backend: d.meta.backend,
    model: d.meta.model,
  };
}

const rows = [];
for (const c of CASES) {
  const t0 = performance.now();
  const code = codeDecision(c);
  const codeMs = performance.now() - t0;
  const dec = await deciderDecision(c).catch((e: unknown) => ({ error: String(e).slice(0, 200) }));
  const shipped = await shippedDecision(c);
  rows.push({ id: c.id, expected: c.expected, code, codeMs, decider: dec, shipped });
}

const keys = ["app", "database", "auth"] as const;
const score = (get: (r: (typeof rows)[number]) => Record<string, string> | undefined) =>
  Object.fromEntries(
    keys.map((k) => [
      k,
      `${rows.filter((r) => get(r)?.[k] === r.expected[k]).length}/${rows.length}`,
    ]),
  );
const decided = rows
  .map((r) => r.decider)
  .filter((d): d is Exclude<typeof d, { error: string }> => !("error" in d));
const lat = decided.map((d) => d.latencyMs).sort((a, b) => a - b);
const tokens = decided.reduce((s, d) => s + d.tokens, 0);
const summary = {
  label: LABEL,
  date: new Date().toISOString(),
  cases: rows.length,
  code: {
    accuracy: score((r) => r.code),
    latencyMsPerRepo: Number((rows.reduce((s, r) => s + r.codeMs, 0) / rows.length).toFixed(3)),
    costUsd: 0,
  },
  decider: {
    backend: decided[0]?.backend ?? null,
    model: decided[0]?.model ?? null,
    errors: rows.length - decided.length,
    accuracy: score((r) => ("error" in r.decider ? undefined : r.decider.decision)),
    latencyMsPerRepo: { p50: lat[Math.floor(lat.length / 2)] ?? 0, max: lat[lat.length - 1] ?? 0 },
    tokens,
    costUsd: Number(((tokens * DECIDER_PRICE) / 1e6).toFixed(5)),
  },
};
const shippedMs = rows.map((r) => r.shipped.ms).sort((a, b) => a - b);
const asked = rows.filter((r) => r.shipped.by === "decider" || r.shipped.ms > 5);
Object.assign(summary, {
  shipped: {
    note: "chooseAppPath (decider for several apps, heuristic fallback) + code for database and auth",
    accuracy: score((r) => r.shipped.decision),
    decidedBy: Object.fromEntries(
      ["decider", "code"].map((b) => [b, rows.filter((r) => r.shipped.by === b).length]),
    ),
    latencyMsPerRepo: {
      p50: Math.round(shippedMs[Math.floor(shippedMs.length / 2)] ?? 0),
      max: Math.round(shippedMs[shippedMs.length - 1] ?? 0),
      meanWhenAsked: Math.round(
        asked.reduce((s2, r) => s2 + r.shipped.ms, 0) / Math.max(1, asked.length),
      ),
    },
    tokens: shippedTokens,
    costUsd: Number(((shippedTokens * DECIDER_PRICE) / 1e6).toFixed(5)),
  },
});
const dir = join(import.meta.dirname, "runs");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, `adaptation-${LABEL}.json`),
  `${JSON.stringify({ summary, rows }, null, 2)}\n`,
);
console.log(JSON.stringify(summary));
for (const r of rows)
  for (const k of keys) {
    const dv = "error" in r.decider ? "error" : r.decider.decision[k];
    if (r.code[k] !== r.expected[k] || dv !== r.expected[k])
      console.log(`${r.id} ${k}: expected=${r.expected[k]} code=${r.code[k]} decider=${dv}`);
  }
