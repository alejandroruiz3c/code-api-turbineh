import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { writeAcceptance, type CriterionStatus } from "./acceptance.js";

/**
 * Agent-ready package (ADR-0032): every delivered package carries AGENTS.md (+ CLAUDE.md importing it) and the same
 * facts machine-readable in turbineh.json, so a coding agent knows at once what the package does, where each feature
 * lives, how to extend it, which acceptance criteria are met (and the test that proves it) or open (and where to
 * implement them), the verified gate results, and the cheapest command to re-run after each kind of change.
 * Everything here is derived deterministically from the repository, the build spec and the verification result.
 */

export const GUIDE_FILE = "turbineh.json";
export const GUIDE_SCHEMA = "turbineh.package/v1";

export interface GuideFile {
  path: string;
  about: string;
}
export interface GuideCriterion {
  text: string;
  /** met: proven by a passing test; open: no test proves it yet; unverified: the gate has not passed. */
  status: "met" | "open" | "unverified";
  test?: { file: string; title: string };
  /** For open criteria: the files where it most likely belongs. */
  where?: string[];
  /** For open criteria: the spec file where its E2E test belongs. */
  testFile?: string;
}
export interface GuideGateFinding {
  category: "security" | "policy" | "quality";
  rule: string;
  where: string;
  blocking: boolean;
  message: string;
}
/** One failing check of a delivered, not verified package (ADR-0037 §D1): exact place, owner and suggested fix. */
export interface GuideFailure {
  step: string;
  /** Failing test as the runner names it, or null for lint/typecheck/build. */
  test: string | null;
  /** file:line, or the step name when the output names no file. */
  where: string;
  /** Owner of the failing file (`component:<id>`, `recipe:<id>`, `entity:<Name>`…), from .turbineh/owners.json. */
  owner: string | null;
  message: string;
  /** Cheapest command that reproduces it. */
  rerun: string;
  fix: string;
}

export interface GuideLeft {
  kind: "criterion" | "gap" | "gate" | "setting";
  what: string;
  where: string;
  how: string;
}
export interface PackageGuide {
  schema: typeof GUIDE_SCHEMA;
  buildId: string;
  app: { name: string; summary: string };
  recipe: { id: string; description: string };
  status: "verified" | "failed" | "unverified";
  /**
   * False when the package is delivered although the gate failed (ADR-0037 §D1): never present it as verified. Absent
   * before verification.
   */
  verified?: boolean;
  /** Checks passed / total of the gate ("10/11"), once verified. */
  checks?: string;
  /** Exact failures of a delivered, not verified package, each with the suggested fix. */
  failures?: GuideFailure[];
  /** What a coding agent still has to do. Empty = nothing: the package meets the spec and passed the gate. */
  left: GuideLeft[];
  criteria: GuideCriterion[];
  gaps: { capability: string; reason: string }[];
  gate: {
    ok: boolean;
    verifiedAt: string;
    environment: string;
    steps: { name: string; ok: boolean; ms: number }[];
    findings: GuideGateFinding[];
  } | null;
  files: { area: string; files: GuideFile[] }[];
  extend: { what: string; where: string; how: string }[];
  theme: { file: string; tokens: Record<string, string> };
  env: { required: { name: string; about: string }[]; optional: { name: string; about: string }[] };
  tests: { file: string; kind: "e2e" | "unit"; titles: string[] }[];
  rerun: { change: string; run: string; note: string }[];
  /**
   * Spec fidelity (ADR-0043): parts of the request no catalog component implements yet (domain patterns) and wiring
   * the generator could not do, each with where and how. Their criteria stay open until a test proves them.
   */
  todo?: { what: string; where: string; how: string }[];
}

export interface RecipeGuide {
  extend?: { what: string; where: string; how: string }[];
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "playwright",
  "test-results",
  "drizzle",
  ".turbineh",
]);

function walk(dir: string, root = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, root) : [relative(root, p)];
  });
}

/** First documentation line of a source file (first JSDoc / line comment), trimmed to one sentence. */
export function aboutOf(source: string): string {
  // A top-level doc comment (column 0) directly before the first declaration, else a header line comment before any
  // code. Comments inside functions (lint pragmas, inline notes) never describe the file.
  const main =
    /^\/\*\*\s*\n?\s*\*?\s*([^\n*][^\n]*)(?:(?!\*\/)[\s\S])*\*\/\s*\nexport default/m.exec(source);
  const doc =
    main ??
    /^\/\*\*\s*\n?\s*\*?\s*([^\n*][^\n]*)[\s\S]*?\*\/\s*\n(?:export|async|function|const|interface|type)/m.exec(
      source,
    );
  const header = /^(?:\/\/[^\n]*\n|\s*\n)*?\/\/\s*(?!turbineh:|eslint|nosemgrep)([^\n]+)/.exec(
    source,
  );
  const firstCode = source.search(/^(import|export|const|function|async|"use)/m);
  const m = doc ?? (header && (firstCode < 0 || (header.index ?? 0) < firstCode) ? header : null);
  const line = (m?.[1] ?? "").replace(/\*\/\s*$/, "").trim();
  if (/^(turbineh:|eslint|nosemgrep)/.test(line)) return "";
  const sentence = line.split(/(?<=\.)\s/)[0] ?? line;
  return sentence.length > 140 ? `${sentence.slice(0, 137)}…` : sentence;
}

/** Route of an App Router file: src/app/shop/[slug]/page.tsx → /shop/[slug]. */
const routeOf = (path: string) =>
  `/${path
    .replace(/^src\/app\/?/, "")
    .split("/")
    .slice(0, -1)
    .join("/")}`;

const AREAS: [RegExp, string][] = [
  [/^src\/app\/dashboard\//, "Admin / signed-in area (src/app/dashboard)"],
  [/^src\/app\/api\//, "API routes and webhooks (src/app/api)"],
  [/^src\/app\//, "Public pages and routes (src/app)"],
  [/^src\/(entities|db)\//, "Data: tables and validation (src/db, src/entities)"],
  [/^src\/server\//, "Server logic and authorization (src/server)"],
  [/^src\/lib\//, "Libraries and business rules (src/lib)"],
  [/^src\/security\//, "Security Pack (src/security)"],
  [/^src\/(components|content)\//, "UI components and site copy (src/components, src/content)"],
  [/^src\//, "Other source"],
];

/** Every source file grouped by area, with its own one-line description. */
export function fileMap(outDir: string): PackageGuide["files"] {
  const groups = new Map<string, GuideFile[]>();
  for (const path of walk(join(outDir, "src"), outDir).sort()) {
    if (!/\.(ts|tsx|css)$/.test(path)) continue;
    const area = AREAS.find(([re]) => re.test(path))?.[1] ?? "Other source";
    const src = readFileSync(join(outDir, path), "utf8");
    let about = aboutOf(src);
    if (path.startsWith("src/app/") && /\/(page|route|layout)\.tsx?$/.test(path)) {
      const kind = /route\.ts$/.test(path) ? "route" : /layout/.test(path) ? "layout" : "page";
      about = `${kind} ${routeOf(path)}${about ? ` — ${about}` : ""}`;
    }
    groups.set(area, [...(groups.get(area) ?? []), { path, about }]);
  }
  return AREAS.map(([, area]) => area)
    .filter((a, i, all) => all.indexOf(a) === i && groups.has(a))
    .map((area) => ({ area, files: groups.get(area) ?? [] }));
}

/** Environment variables from src/env.ts (required unless optional/defaulted) plus .env.example comments. */
export function envOf(outDir: string): PackageGuide["env"] {
  const example = existsSync(join(outDir, ".env.example"))
    ? readFileSync(join(outDir, ".env.example"), "utf8")
    : "";
  const comments = new Map<string, string>();
  let last = "";
  const exampleVars: string[] = [];
  for (const line of example.split("\n")) {
    if (line.startsWith("#")) last = line.replace(/^#\s*/, "");
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m?.[1]) {
      comments.set(m[1], last);
      exampleVars.push(m[1]);
      last = "";
    }
  }
  const required: { name: string; about: string }[] = [];
  const optional: { name: string; about: string }[] = [];
  const seen = new Set<string>();
  const envTs = existsSync(join(outDir, "src/env.ts"))
    ? readFileSync(join(outDir, "src/env.ts"), "utf8")
    : "";
  const keys = [...envTs.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)];
  keys.forEach((k, i) => {
    const name = k[1] as string;
    const chunk = envTs.slice(k.index, keys[i + 1]?.index ?? envTs.length);
    const isOptional = /\.optional\(\)|\.default\(/.test(chunk) || ["NODE_ENV"].includes(name);
    const about = comments.get(name) ?? "";
    (isOptional ? optional : required).push({ name, about });
    seen.add(name);
  });
  // Variables declared only by components (.env.example): optional unless the comment says required.
  for (const name of exampleVars.filter((v) => !seen.has(v))) {
    const about = comments.get(name) ?? "";
    (/\brequired\b/i.test(about) && !/optional/i.test(about) ? required : optional).push({
      name,
      about,
    });
  }
  return { required, optional };
}

/** Theme tokens of src/app/globals.css (`@theme`). */
export function themeOf(outDir: string): PackageGuide["theme"] {
  const file = "src/app/globals.css";
  const css = existsSync(join(outDir, file)) ? readFileSync(join(outDir, file), "utf8") : "";
  const block = /@theme\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const tokens: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g))
    tokens[m[1] as string] = (m[2] ?? "").trim();
  return { file, tokens };
}

/** Test files and their test titles. */
export function testsOf(outDir: string): PackageGuide["tests"] {
  return walk(join(outDir, "tests"), outDir)
    .filter((p) => /\.(spec|test|setup)\.ts$/.test(p))
    .sort()
    .map((file) => {
      const src = readFileSync(join(outDir, file), "utf8");
      const titles = [...src.matchAll(/(?:test|it|setup)\(\s*"([^"]{5,200})"/g)].map(
        (m) => m[1] as string,
      );
      return {
        file,
        kind: file.startsWith("tests/e2e") ? ("e2e" as const) : ("unit" as const),
        titles,
      };
    });
}

const STOP = new Set(
  "a an and are as at be by can for from has have in into is it its of on or that the their them they this to when with without user users app page pages should must every each".split(
    " ",
  ),
);
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.replace(/(ies)$/, "y").replace(/s$/, ""))
    .filter((w) => w.length > 2 && !STOP.has(w));

/** Files where an open criterion most likely belongs (deterministic word overlap with paths and descriptions). */
export function whereFor(criterion: string, files: PackageGuide["files"]): string[] {
  const want = new Set(words(criterion));
  return files
    .flatMap((g) => g.files)
    .map((f) => ({
      path: f.path,
      score: words(`${f.path} ${f.about}`).filter((w) => want.has(w)).length,
    }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 3)
    .map((f) => f.path);
}

/** The E2E spec where a criterion's test belongs: the spec whose titles share the most words with it. */
export function testFileFor(criterion: string, tests: PackageGuide["tests"]): string {
  const want = new Set(words(criterion));
  const specs = tests.filter((t) => t.kind === "e2e" && t.file.endsWith(".spec.ts"));
  const best = specs
    .map((t) => ({
      file: t.file,
      score: words(`${t.file} ${t.titles.join(" ")}`).filter((w) => want.has(w)).length,
    }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))[0];
  return best && best.score > 0 ? best.file : "tests/e2e/app.spec.ts";
}

/** Extension points every recipe has; recipes add their own in recipe.yaml (`guide.extend`). */
export const BASE_EXTEND: PackageGuide["extend"] = [
  {
    what: "Add a field to a data entity",
    where:
      "src/db/tables/<entity>.ts + src/entities/<entity>/schema.ts + src/app/dashboard/<entity>/page.tsx",
    how: "Add the column, the Zod field and the form input, then `pnpm db:generate` (a new migration in drizzle/).",
  },
  {
    what: "Add a page",
    where: "src/app/<route>/page.tsx",
    how: "Server component; signed-in pages call `await requireMember()` (src/server/authz.ts) first. Add nav entries in src/entities/index.ts.",
  },
  {
    what: "Add a server action",
    where: "src/app/<route>/actions.ts",
    how: '"use server"; first line of every exported action: `await requireMember()` (or requireAdmin()); validate input with Zod; filter by organizationId. Own authorization helpers count only when named require*/assert*/ensure*.',
  },
  {
    what: "Add a public action (anonymous visitors: public booking, contact, waitlist, a link from an email)",
    where: "src/app/<route>/actions.ts, src/server/authz.ts",
    how: '"use server"; `export const x = publicAction("<name>", { rateLimit: { limit: 5 }, schema, refuse }, async (input) => …)`: per-IP rate limit and Zod validation run first (both mandatory); never a plain exported function or a nosemgrep comment.',
  },
  {
    what: "Add an action for signed-in non-members (accept an invitation, onboarding, first workspace)",
    where: "src/app/<route>/actions.ts, src/server/authz.ts",
    how: "First line: `const { userId, email } = await requireSession()` (signed in, no workspace needed); anything that touches workspace data uses requireMember().",
  },
  {
    what: "Add a setting or secret",
    where: "src/env.ts, .env.example, playwright.config.ts",
    how: "Required settings have no .default() and no placeholder value in code (no secret-shaped literal anywhere, tests included): `pnpm build` gets build-only values generated in src/env.ts, tests generate theirs at runtime (randomBytes in playwright.config.ts), real values go in .env.local.",
  },
  {
    what: "Add a business rule",
    where: "src/entities/<entity>/rules.ts (contract in src/lib/rules.ts)",
    how: "Return a user-facing message when a record breaks the rule, else null; add a unit test in tests/unit/.",
  },
  {
    what: "Change who can sign up / who is staff",
    where: "src/lib/sign-up-policy.ts, ADMIN_EMAILS (src/lib/staff.ts)",
    how: '"open" = anyone, "staff" = only ADMIN_EMAILS (deny by default).',
  },
  {
    what: "Change colours, surfaces or type",
    where: "src/app/globals.css (@theme)",
    how: "Edit the tokens; components use only token classes (bg-surface, bg-panel, text-ink, text-muted, border-line, bg-brand, text-accent…).",
  },
  {
    what: "Call a new external service",
    where: "src/env.ts (base URL + key) and tests/e2e/mocks/<BASE_URL_ENV>.mjs",
    how: "Read its base URL from env; ship a local mock named after that env var (it starts automatically in E2E and must answer GET /health).",
  },
  {
    what: "Use your own PostgreSQL instead of the local one",
    where: "DATABASE_URL (.env.local), scripts/local-db.ts",
    how: "Set DATABASE_URL and every command uses it; leave it unset (or the .env.example value) for the zero-setup local database. E2E always starts a fresh one when DATABASE_URL is unset.",
  },
  {
    what: "Prove a new acceptance criterion",
    where: "tests/e2e/<area>.spec.ts",
    how: 'Add an E2E test whose title states the criterion; run `pnpm test:e2e <spec> -g "<title>"` (no database setup needed).',
  },
  {
    what: "Allow images or connections from another origin",
    where: "src/security/csp-sources.ts",
    how: "Add the source (https only); the CSP in src/security/headers.ts picks it up.",
  },
];

/** Cheapest command per kind of change (avoid re-running the whole E2E suite for a copy change). */
export function rerunGuide(tests: PackageGuide["tests"]): PackageGuide["rerun"] {
  const e2e = tests.filter((t) => t.kind === "e2e" && !t.file.endsWith(".setup.ts"));
  return [
    {
      change: "Copy or text (src/content/site.ts, labels in pages)",
      run: "pnpm lint && pnpm typecheck",
      note: "If a label an E2E test selects changes, also run that one spec (below).",
    },
    {
      change: "Theme tokens (src/app/globals.css)",
      run: "pnpm build",
      note: "No test asserts colours; check the page in `pnpm dev`.",
    },
    {
      change: "Pure logic in src/lib or src/entities/*/rules.ts",
      run: "pnpm exec vitest run tests/unit/<file>.test.ts",
      note: "Unit tests need no database; `pnpm test` runs them all in seconds.",
    },
    {
      change: "A page, server action or API route",
      run: 'pnpm typecheck && pnpm build && pnpm test:e2e <spec> -g "<test title>"',
      note: `Specs: ${e2e.map((t) => t.file).join(", ") || "tests/e2e"}. Nothing to set up: without DATABASE_URL, \`pnpm test:e2e\` starts a fresh local PostgreSQL (scripts/local-db.ts), migrates it and owns its URLs and port; mocks and test secrets start automatically.`,
    },
    {
      change: "Database schema (src/db)",
      run: "pnpm db:generate && pnpm db:migrate && pnpm typecheck",
      note: "Commit the new migration in drizzle/. Without DATABASE_URL, db:migrate uses the local database (no PostgreSQL to install); then run the spec that touches the table.",
    },
    {
      change: "Need a database for dev or a SQL client",
      run: "pnpm db:local",
      note: "Zero setup: a persistent local PostgreSQL in .turbineh/local-db on the DATABASE_URL of .env.example; `pnpm dev` and `pnpm db:migrate` start it on their own when DATABASE_URL is not set.",
    },
    {
      change: "Environment variable",
      run: "pnpm typecheck",
      note: "Declare it in src/env.ts (Zod) and .env.example; optional unless the app cannot start without it (build and tests run with only the required ones); no .default() or placeholder for a required one; never commit values.",
    },
    {
      change: "Before handing over (everything)",
      run: "pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e",
      note: "Same steps as the TurbineH gate (which also runs gitleaks, Semgrep rules, OSV and the licence policy). Server actions: requireMember()/requireAdmin(), requireSession() or publicAction() (src/server/authz.ts); no secret-shaped literal anywhere.",
    },
  ];
}

/** What is left, derived from criteria, gaps, the gate and required settings. */
export function leftOf(g: Omit<PackageGuide, "left">): GuideLeft[] {
  const left: GuideLeft[] = [];
  // A delivered, not verified package: the exact failures come first, each with its fix.
  for (const f of g.failures ?? []) {
    left.push({
      kind: "gate",
      what: `NOT VERIFIED · ${f.step}${f.test ? ` · "${f.test}"` : ""}: ${f.message}`,
      where: f.where,
      how: f.fix,
    });
  }
  const explained = new Set((g.failures ?? []).map((f) => f.step));
  for (const c of g.criteria.filter((x) => x.status === "open")) {
    const spec = c.testFile ?? "tests/e2e/app.spec.ts";
    left.push({
      kind: "criterion",
      what: c.text,
      where: [...(c.where?.length ? c.where : ["src/app"]), spec].join(", "),
      how: `Implement it in the files listed and prove it with an E2E test in ${spec} whose title states the criterion; nothing proves it yet.`,
    });
  }
  for (const t of g.todo ?? []) left.push({ kind: "gap", ...t });
  for (const gap of g.gaps) {
    left.push({
      kind: "gap",
      what: `Capability not included: ${gap.capability}`,
      where: "—",
      how: gap.reason,
    });
  }
  for (const f of g.gate?.findings.filter(
    (x) => x.blocking && !(x.category === "quality" && explained.has(x.rule)),
  ) ?? []) {
    left.push({
      kind: "gate",
      what: `${f.category} · ${f.rule}: ${f.message}`,
      where: f.where,
      how:
        f.category === "policy"
          ? "Policy finding (not a vulnerability): follow the message to comply."
          : "Fix at the location shown, then re-run the matching command below.",
    });
  }
  return left;
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** AGENTS.md: a short render of turbineh.json for coding agents. */
export function agentsMarkdown(g: PackageGuide): string {
  const status =
    g.status === "verified"
      ? `**Verified**: the TurbineH gate passed on ${g.gate?.verifiedAt} (${g.gate?.environment}).`
      : g.status === "failed"
        ? `**Delivered, not verified: ${g.checks ?? "some"} checks passed** (TurbineH gate on ${g.gate?.verifiedAt}). Do not treat it as verified: fix the failure under "What is left" first, then re-run the gate.`
        : "**Not verified yet** (the gate result is added when verification finishes).";
  const crit = g.criteria
    .map((c) => {
      const proof =
        c.status === "met"
          ? `met — \`${c.test?.file}\` › "${esc(c.test?.title ?? "")}"`
          : c.status === "open"
            ? `**open** — implement in ${c.where?.map((w) => `\`${w}\``).join(", ") || "src/app"}; prove it in \`${c.testFile ?? "tests/e2e/app.spec.ts"}\``
            : c.test
              ? `implemented, not verified — \`${c.test.file}\` › "${esc(c.test.title)}"`
              : "not verified";
      return `| ${esc(c.text)} | ${proof} |`;
    })
    .join("\n");
  const left = g.left.length
    ? g.left.map((l) => `- [${l.kind}] ${l.what} — where: ${l.where} — how: ${l.how}`).join("\n")
    : g.status === "verified"
      ? "- **Nothing.** Every acceptance criterion is proven by a passing test and the gate passed. Only change what your task asks; re-run only what the table below says."
      : "- Nothing known yet; the gate result will be added here.";
  return `<!-- turbineh:generated — rendered from turbineh.json; keep both in sync if you edit -->
# ${g.app.name} — guide for coding agents

${g.app.summary}

Recipe \`${g.recipe.id}\`: ${g.recipe.description}. Build \`${g.buildId}\`. ${status}

Read this file instead of the whole repository. The same facts are machine-readable in \`turbineh.json\`
(TurbineH CLI: \`turbineh left\` prints what is left, \`turbineh verify\` runs the cheap checks with file:line and fix;
install: \`curl -fsSL https://software.turbineh.com/install.sh | sh\`).

## What is left

${left}

## Acceptance criteria

| Criterion | Status and proof |
|---|---|
${crit || "| (none) | |"}

## Verified gate results

${
  g.gate
    ? `${g.gate.steps.map((s) => `${s.ok ? "pass" : "FAIL"} ${s.name}${s.ms ? ` (${(s.ms / 1000).toFixed(1)} s)` : ""}`).join(" · ")}

${
  g.gate.findings.length
    ? g.gate.findings
        .map(
          (f) =>
            `- ${f.blocking ? "blocking" : "non-blocking"} **${f.category}** \`${f.rule}\` at \`${f.where}\`: ${f.message}`,
        )
        .join("\n")
    : "- No findings."
}`
    : "Not run yet."
}

## What to re-run after a change

| Change | Cheapest command | Note |
|---|---|---|
${g.rerun.map((r) => `| ${esc(r.change)} | \`${r.run}\` | ${esc(r.note)} |`).join("\n")}

## Where things are

${g.files
  .map(
    (a) =>
      `### ${a.area}\n\n${a.files.map((f) => `- \`${f.path}\`${f.about ? ` — ${f.about}` : ""}`).join("\n")}`,
  )
  .join("\n\n")}

## Extension points

| To | Where | How |
|---|---|---|
${g.extend.map((e) => `| ${esc(e.what)} | \`${esc(e.where)}\` | ${esc(e.how)} |`).join("\n")}

## Theme tokens (\`${g.theme.file}\`)

${Object.entries(g.theme.tokens)
  .map(([k, v]) => `\`--${k}\`: ${v.length > 40 ? `${v.slice(0, 40)}…` : v}`)
  .join(" · ")}

## Environment

Required: ${g.env.required.map((e) => `\`${e.name}\``).join(", ") || "none"}.
Optional: ${g.env.optional.map((e) => `\`${e.name}\`${e.about ? ` (${esc(e.about)})` : ""}`).join(", ") || "none"}.
Build and unit tests need only the required variables. Tests need nothing else: without \`DATABASE_URL\`,
\`pnpm db:migrate\`, \`pnpm dev\` and \`pnpm test:e2e\` use a zero-setup local PostgreSQL (\`pnpm db:local\`,
\`scripts/local-db.ts\`); E2E owns its URLs and port, and test secrets and service mocks (\`tests/e2e/mocks/\`) are
generated and started by \`playwright.config.ts\`.

## Tests

${g.tests.map((t) => `- \`${t.file}\` (${t.kind}, ${t.titles.length})`).join("\n")}
`;
}

export function readAcceptanceJson(outDir: string): CriterionStatus[] {
  const file = join(outDir, ".turbineh/acceptance.json");
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf8")) as CriterionStatus[];
  } catch {
    return [];
  }
}

/** Writes turbineh.json, AGENTS.md and CLAUDE.md (an import of AGENTS.md for Claude Code). */
export function writeAgentGuide(outDir: string, guide: Omit<PackageGuide, "left">): PackageGuide {
  const full: PackageGuide = { ...guide, left: leftOf(guide) };
  writeFileSync(join(outDir, GUIDE_FILE), `${JSON.stringify(full, null, 2)}\n`);
  writeFileSync(join(outDir, "AGENTS.md"), agentsMarkdown(full));
  writeFileSync(
    join(outDir, "CLAUDE.md"),
    "<!-- turbineh:generated -->\n# Instructions for Claude Code\n\n@AGENTS.md\n",
  );
  return full;
}

/** Guide at assembly time (before verification): structure, extension points, criteria not verified yet. */
export function initialGuide(input: {
  outDir: string;
  buildId: string;
  app: { name: string; summary: string };
  recipe: { id: string; description: string; guide?: RecipeGuide };
  criteria: string[];
  gaps: { capability: string; trigger: string }[];
  /** Installed catalog components and their extension points (guide.yaml), listed after the recipe's. */
  components?: { id: string; extend: { what: string; where: string; how: string }[] }[];
  /** What the request asks that the package does not implement yet, with where and how (spec fidelity). */
  todo?: { what: string; where: string; how: string }[];
}): Omit<PackageGuide, "left"> {
  const files = fileMap(input.outDir);
  const tests = testsOf(input.outDir);
  return {
    schema: GUIDE_SCHEMA,
    buildId: input.buildId,
    app: input.app,
    recipe: { id: input.recipe.id, description: input.recipe.description },
    status: "unverified",
    criteria: input.criteria.map((text) => ({ text, status: "unverified" as const })),
    gaps: input.gaps.map((g) => ({
      capability: g.capability,
      reason: `No verified catalog component was integrated (${g.trigger}). Add it yourself or ask for it in a new build.`,
    })),
    gate: null,
    files,
    extend: [
      ...(input.recipe.guide?.extend ?? []),
      ...(input.components ?? []).flatMap((c) =>
        c.extend.map((e) => ({ ...e, what: `${e.what} (${c.id})` })),
      ),
      ...BASE_EXTEND,
    ],
    theme: themeOf(input.outDir),
    env: envOf(input.outDir),
    tests,
    rerun: rerunGuide(tests),
    ...(input.todo?.length ? { todo: input.todo } : {}),
  };
}

/**
 * After verification: refreshes the structure (files may have changed), adds the gate result and each criterion's
 * proof. A criterion is met only when the gate passed and a passing test was matched to it.
 */
export function verifiedGuide(
  outDir: string,
  input: {
    gate: NonNullable<PackageGuide["gate"]>;
    /** Criterion → evidence ("End-to-end test: <title>" / "Unit test: <title>"), as mapped by the report. */
    criteria: { criterion: string; evidence: string; verified: boolean }[];
    gaps?: string[];
    /** Exact failures with owner and fix when the gate failed (ADR-0037 §D1). */
    failures?: GuideFailure[];
  },
): PackageGuide | null {
  const path = join(outDir, GUIDE_FILE);
  if (!existsSync(path)) return null;
  const prev = JSON.parse(readFileSync(path, "utf8")) as PackageGuide;
  const files = fileMap(outDir);
  const tests = testsOf(outDir);
  const fileOf = (title: string) => tests.find((t) => t.titles.includes(title))?.file;
  // Deterministic proofs first (acceptance.yaml rules matched at assembly, .turbineh/acceptance.json), then the
  // report's mapping. Either way a criterion is met only with a test that exists in the package and a passed gate.
  const shipped = (ref: string) => {
    const [file = "", title = ""] = ref.split(" › ");
    return tests.some((t) => t.file === file && t.titles.includes(title)) ? { file, title } : null;
  };
  const deterministic = readAcceptanceJson(outDir);
  const criteria: GuideCriterion[] = input.criteria.map((c) => {
    const ruled = deterministic
      .find((d) => d.criterion === c.criterion)
      ?.tests.map(shipped)
      .find((t) => t !== null);
    const title = c.evidence.replace(/^(End-to-end|Unit) test:\s*/, "");
    const file = fileOf(title);
    const test = ruled ?? (c.verified && file ? { file, title } : null);
    if (test) {
      return {
        text: c.criterion,
        status: input.gate.ok ? ("met" as const) : ("unverified" as const),
        test,
      };
    }
    return {
      text: c.criterion,
      status: "open" as const,
      where: whereFor(c.criterion, files),
      testFile: testFileFor(c.criterion, tests),
    };
  });
  // ACCEPTANCE.md and .turbineh/acceptance.json say exactly what AGENTS.md says.
  writeAcceptance(
    outDir,
    criteria.map((c): CriterionStatus => ({
      criterion: c.text,
      status: c.status === "met" ? "met" : c.status === "open" ? "open" : "covered",
      tests: c.test ? [`${c.test.file} › ${c.test.title}`] : [],
    })),
  );
  const gaps = input.gaps
    ? prev.gaps
        .filter((g) => input.gaps?.includes(g.capability))
        .concat(
          input.gaps
            .filter((c) => !prev.gaps.some((g) => g.capability === c))
            .map((capability) => ({
              capability,
              reason:
                "Removed before delivery because it could not be made green; add it yourself or ask for it in a new build.",
            })),
        )
    : prev.gaps;
  return writeAgentGuide(outDir, {
    ...prev,
    status: input.gate.ok ? "verified" : "failed",
    verified: input.gate.ok,
    checks: `${input.gate.steps.filter((x) => x.ok).length}/${input.gate.steps.length}`,
    failures: input.gate.ok ? [] : (input.failures ?? []),
    criteria,
    gaps,
    gate: input.gate,
    files,
    theme: themeOf(outDir),
    env: envOf(outDir),
    tests,
    rerun: rerunGuide(tests),
  });
}
