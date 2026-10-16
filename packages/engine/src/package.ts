import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type { CheckResult, FlowState, Plan } from "@turbineh/shared";
import { agentInstructions, checkLabel } from "./result.js";

/**
 * Capability package (PLAN §16.3): the deliverable, as a ZIP or as changes in a repository. Same layout for a
 * complete flow (built from the verified app) and for components only (built from certified catalog components).
 */
export const PACKAGE_LAYOUT = [
  "README.md",
  "manifest.json",
  "src",
  "examples",
  "tests",
  "config/.env.example",
  "docs/integration.md",
  "docs/architecture.md",
  "docs/verification.md",
  "agent/INTEGRATE.md",
  "LICENSES",
] as const;

export interface PackageComponent {
  id: string;
  version: string;
  license: string;
  purl: string;
  capability: string;
  why?: string;
}

export interface PackageInfo {
  slug: string;
  name: string;
  need: string;
  planId: string;
  state: FlowState;
  summary: string;
  components: PackageComponent[];
  checks: CheckResult[];
  plan?: Plan;
  metrics?: {
    seconds: number;
    tokens: number;
    reusedShare: number;
    newLines: number;
    securityFindings: number;
  };
  /** Optional TurbineH documents of the verified app (report, security, deploy) — copied into docs/. */
  docs?: Record<string, string>;
}

/** Product surfaces describe TurbineH's own technology only (no third-party engine names). */
export function productText(s: string): string {
  return s
    .replace(/\b(JEV|Jev|jev)(\s+by\s+TypeSafe(\s+AI)?)?\b/g, "TurbineH orchestration")
    .replace(/\bTypeSafe(\s+AI)?\b/g, "TurbineH")
    .replace(/\bQuyet\b/g, "TurbineH open decider")
    .replace(/\bSystemOne\b/g, "decision engine");
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function trackedFiles(dir: string): string[] {
  try {
    return execFileSync("git", ["ls-files"], { cwd: dir }).toString().split("\n").filter(Boolean);
  } catch {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        if (["node_modules", ".git", ".next"].includes(f)) continue;
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(relative(dir, p));
      }
    };
    walk(dir);
    return out;
  }
}

function copyTracked(
  fromDir: string,
  files: string[],
  toDir: string,
  filter: (f: string) => boolean,
): number {
  let n = 0;
  for (const f of files.filter(filter)) {
    const src = join(fromDir, f);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(join(toDir, f)), { recursive: true });
    cpSync(src, join(toDir, f));
    n++;
  }
  return n;
}

/** Entry points a person or an agent starts from (routes, server actions, schema, AI orchestrator). */
export function entryPoints(files: string[]): string[] {
  return files
    .filter(
      (f) =>
        /^src\/app\/.+\/page\.tsx$/.test(f) ||
        /^src\/app\/api\/.+\/route\.ts$/.test(f) ||
        /^src\/entities\/[^/]+\/actions\.ts$/.test(f) ||
        f === "src/db/schema.ts" ||
        f === "src/lib/ai/orchestrator.ts",
    )
    .sort()
    .slice(0, 40);
}

const envKeys = (env: string) =>
  env
    .split("\n")
    .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l.trim())?.[1])
    .filter((k): k is string => Boolean(k));

function manifest(
  info: PackageInfo,
  deps: Record<string, string>,
  env: string[],
  entries: string[],
) {
  return {
    schema: "turbineh.capability/v1",
    name: info.name,
    slug: info.slug,
    version: "1.0.0",
    need: info.need,
    state: info.state,
    planId: info.planId,
    summary: productText(info.summary),
    stack: {
      language: "typescript",
      runtime: "node>=20",
      framework: "nextjs@16 (App Router)",
      database: "postgres",
    },
    capabilities: [...new Set(info.components.map((c) => c.capability))],
    components: info.components.map(({ id, version, license, purl }) => ({
      id,
      version,
      license,
      purl,
    })),
    dependencies: deps,
    environment: env,
    entryPoints: entries,
    checks: info.checks.map(({ name, ok }) => ({ name, ok })),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Scope of a components-only package (ADR-0062): which requirement each component serves and what is out of scope —
 * so neither a person nor a coding agent presents the package as the use case that was asked for.
 */
export function componentsOnlyScope(info: Pick<PackageInfo, "plan">): string {
  const scope = info.plan?.scope;
  const offer = scope?.status === "components_only" ? scope.explanation?.offer : null;
  if (!offer) return "";
  const lines = [
    "## Scope: verified components only",
    "",
    `${scope?.explanation?.title ?? "The library doesn't cover this use case yet"}: **${scope?.explanation?.useCase ?? info.plan?.need ?? ""}** is not built, and this package must not be presented as it. Each component below is delivered exactly as it was verified.`,
    "",
    offer.youGet,
    "",
    `**${offer.notIncluded}**`,
    "",
    "| Component | Gives | For the requirement | Proved by |",
    "|---|---|---|---|",
    ...offer.components.map((c) =>
      c.serves.length
        ? `| \`${c.id}\` | ${c.gives} | ${c.serves.join("; ")} | ${c.proof.map((p) => p.test).join("; ")} |`
        : `| \`${c.id}\` | required by \`${c.requiredBy ?? ""}\` | | |`,
    ),
    "",
    "Out of scope (not built, never faked):",
    "",
    ...offer.outOfScope.map((r) => `- ${r.requirement} — ${r.why}`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function readme(info: PackageInfo, entries: string[], env: string[], full: boolean): string {
  const ok = info.checks.filter((c) => c.ok).length;
  const stateLine =
    info.state === "verified"
      ? `**State: package generated and verified** (${ok}/${info.checks.length} checks in the TurbineH sandbox). Integrating it into your project and checking it there is the next step.`
      : info.state === "generated" && info.checks.length === 0
        ? "**State: package ready, not verified yet.** Each component was certified on its own; the package is verified inside your project when you integrate it (see docs/verification.md)."
        : `**State: ${info.state}.** See docs/verification.md for what was checked.`;
  return `# ${info.name}

${productText(info.summary)}

${stateLine}

${componentsOnlyScope(info)}## Try it (2 minutes)

${
  full
    ? "```bash\ncd examples/app\ncp ../../config/.env.example .env.local   # add a PostgreSQL URL\npnpm install && pnpm db:migrate && pnpm dev\n```"
    : "See `examples/README.md` — each component has a minimal usage example and its contract test in `tests/`."
}

## Integrate

- With a coding agent: *"${agentInstructions(info.slug)}"*
- By hand: follow [docs/integration.md](docs/integration.md).
- With the CLI: \`turbineh apply\` (shows files, dependencies and settings before changing anything), then \`turbineh verify\`.

## What is inside

| Folder | Content |
|---|---|
| \`src/\` | Capability code, editable, with clear entry points |
| \`examples/\` | ${full ? "The verified app with sample data" : "Usage examples"} |
| \`tests/\` | Checks you can run in your project |
| \`config/.env.example\` | Settings (names only, no secrets) |
| \`docs/\` | Integration steps, architecture decisions, verification results |
| \`agent/INTEGRATE.md\` | Instructions for Claude Code or Codex |
| \`LICENSES/\` | Components, versions and licences |

## Entry points

${entries.length ? entries.map((e) => `- \`src/${e.replace(/^src\//, "")}\``).join("\n") : "- See src/ (each module exports its public functions)."}

## Settings you provide

${env.length ? env.map((k) => `- \`${k}\``).join("\n") : "- None."}

Built by TurbineH orchestration: understand intent → orchestrate decisions → execute tasks. ${info.components.length} verified components, ${info.metrics ? `${Math.round(info.metrics.reusedShare * 100)}% of the code reused from audited components` : "audited per component"}.
`;
}

function integrationDoc(
  info: PackageInfo,
  entries: string[],
  env: string[],
  deps: Record<string, string>,
  full: boolean,
): string {
  return `# Integration guide · ${info.name}

## 1 · Check compatibility

Target: TypeScript, Node.js 20+, ${full ? "Next.js 16 (App Router) and PostgreSQL" : "any TypeScript project"}.
${info.plan?.incompatibilities.length ? `\nKnown incompatibilities with your project:\n${info.plan.incompatibilities.map((i) => `- ${i}`).join("\n")}\n` : ""}
## 2 · Add the dependencies

${
  Object.keys(deps).length
    ? Object.entries(deps)
        .map(([n, v]) => `- \`${n}@${v}\``)
        .join("\n")
    : "- None."
}

Install with your package manager (exact versions: they are the ones verified).

## 3 · Copy the code

${
  full
    ? `Copy the folders of \`src/\` you need into your project's \`src/\` (keep the paths: imports use the \`@/\` alias for \`src/\`):

- \`src/entities/\`, \`src/integrations/\`, \`src/lib/\`, \`src/server/\`, \`src/security/\` — server modules
- \`src/db/\` — the Drizzle schema (merge \`schema.ts\` with yours) and migrations
- \`src/app/…\` — the routes of the capability (pages, server actions, API routes)

Already have authentication or a database layer? Keep yours and adapt the imports of \`src/server/authz.ts\` and \`src/db/client.ts\`.`
    : "Copy `src/` into your project (for example under `src/lib/turbineh/`). Each file is self-contained."
}

## 4 · Configure

${env.length ? env.map((k) => `- \`${k}\` (see config/.env.example)`).join("\n") : "- Nothing to configure."}

## 5 · Connect

${entries.length ? entries.map((e) => `- \`${e}\``).join("\n") : "- Import the modules where you need them."}

## 6 · Verify in your project

Run \`turbineh verify\` (or the tests in \`tests/\` with your test runner). ${
    info.state === "verified"
      ? "The package is verified in the TurbineH sandbox; this step proves it inside **your** project."
      : "The package is not verified yet: this step verifies it inside **your** project."
  }

## Revert

\`turbineh revert <integration>\` reverts only the integration commit; work you did afterwards is kept.
`;
}

function architectureDoc(info: PackageInfo): string {
  const d = info.plan?.decisions ?? [];
  return `# Architecture and decisions · ${info.name}

TurbineH orchestration: **understand intent → orchestrate decisions → execute tasks**. Every task is predicted and
decided before anything runs; components are selected (not generated) from an audited repository.

## Components and why

| Capability | Component | Version | Licence | Why |
|---|---|---|---|---|
${info.components.map((c) => `| ${c.capability} | \`${c.id}\` | ${c.version} | ${c.license} | ${productText(c.why ?? "Verified fit")} |`).join("\n")}

${d.length ? `## Decisions\n\n${d.map((x) => `- **${x.topic}** → \`${x.choice}\`. ${productText(x.why)}${x.alternatives.length ? ` Alternatives: ${x.alternatives.join(", ")}.` : ""}`).join("\n")}\n` : ""}
## Quality, safety, cost and time

${
  info.metrics
    ? `- Time to a verified package: ${info.metrics.seconds} s
- Tokens spent by TurbineH: ${info.metrics.tokens.toLocaleString("en")} (reused components cost zero)
- Code reused from audited components: ${Math.round(info.metrics.reusedShare * 100)}%
- New lines to maintain: ${info.metrics.newLines}
- Security findings left at delivery: ${info.metrics.securityFindings}`
    : "- Components were certified one by one (contract tests, strict types, licences, known vulnerabilities)."
}
- Security Pack always included; AI Safety Pack wherever AI runs (input guardrails, budgets, output checks, audit).
`;
}

function verificationDoc(info: PackageInfo, full: boolean): string {
  return `# Verification · ${info.name}

${
  full
    ? "Verified in the TurbineH sandbox: an ephemeral container without internet and without secrets, real PostgreSQL for the end-to-end tests."
    : info.checks.length > 0
      ? "The contract tests of the package's components ran together in the TurbineH sandbox (install without secrets, tests and strict type checking without network). Each component was also certified on its own: contract tests, strict types, licences and known vulnerabilities."
      : "Each component was certified on its own: contract tests and strict type checking in a sandbox without network, licence and vulnerability checks. The package as a whole has not run in the sandbox yet: it is verified inside your project when you integrate it."
}

| Check | Result |
|---|---|
${info.checks.length ? info.checks.map((c) => `| ${checkLabel(c.name)} | ${c.ok ? "✅ passed" : "❌ failed"} |`).join("\n") : "| Component certification | ✅ passed |"}

## Limits of what was checked

- Checks ran on the package (state \`${info.state}\`), not inside your project yet: run \`turbineh verify\` after integrating.
- Third-party services (payments, email, AI providers) were replaced by local test doubles; set real credentials to use them.
- Business rules not listed in the tests are not covered.
`;
}

function agentDoc(info: PackageInfo, entries: string[], env: string[], full: boolean): string {
  return `# INTEGRATE.md — instructions for a coding agent (Claude Code, Codex)

Goal: integrate **${info.name}** into this project, verified, keeping the project's conventions.

${componentsOnlyScope(info)}
1. Read \`manifest.json\` (stack, dependencies, components, settings) and \`docs/integration.md\`.
2. Check compatibility with the project (framework, versions, auth and database layers). If something does not fit,
   stop and explain the adaptation you propose before changing code.
3. Add the dependencies from \`manifest.json\` with the project's package manager (keep the exact versions).
4. ${full ? "Bring the modules from `src/` into the project's source tree, reusing the project's own auth/db where they exist; mount the routes listed below." : "Copy the modules from `src/` and import them where the capability is needed."}
5. Add the settings to the project's \`.env.example\` (names only): ${env.length ? env.map((k) => `\`${k}\``).join(", ") : "none"}. Never write secrets.
6. Run the included checks (\`tests/\`) and the project's own checks. Report what passed, what failed and why.
7. Explain any pending adaptation. Do not mark the work as done while credentials or checks are missing.

Entry points:
${entries.length ? entries.map((e) => `- \`${e}\``).join("\n") : "- see src/"}

Rules: AI calls go only through \`src/lib/ai/orchestrator\` (it applies the AI Safety Pack, budgets and audit); keep
the Security Pack files (\`src/security/\`) as they are.

To revert: \`turbineh revert <integration>\` (or \`git revert\` of the integration commit).
`;
}

function licensesDoc(info: PackageInfo): string {
  return `# Licences

| Component | Version | Licence | Source |
|---|---|---|---|
${info.components.map((c) => `| ${c.id} | ${c.version} | ${c.license} | ${c.purl} |`).join("\n")}

Every component's licence was checked against the allowed list (permissive licences only) before it entered the
TurbineH repository, and again for all transitive dependencies when this package was verified.
`;
}

/** Package from a verified app (complete flow). Returns the package directory. */
export function writeFlowPackage(appDir: string, outRoot: string, info: PackageInfo): string {
  const out = join(outRoot, info.slug);
  mkdirSync(out, { recursive: true });
  const files = trackedFiles(appDir);
  copyTracked(appDir, files, out, (f) => f.startsWith("src/"));
  copyTracked(
    appDir,
    files,
    out,
    (f) => f.startsWith("tests/") || f === "playwright.config.ts" || f === "vitest.config.ts",
  );
  copyTracked(appDir, files, join(out, "examples", "app"), () => true);
  const env = existsSync(join(appDir, ".env.example"))
    ? readFileSync(join(appDir, ".env.example"), "utf8")
    : "";
  write(join(out, "config", ".env.example"), env);
  const pkg = existsSync(join(appDir, "package.json"))
    ? (JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      })
    : {};
  const deps = pkg.dependencies ?? {};
  const keys = envKeys(env);
  const entries = entryPoints(files);
  write(
    join(out, "manifest.json"),
    `${JSON.stringify(manifest(info, deps, keys, entries), null, 2)}\n`,
  );
  write(join(out, "README.md"), readme(info, entries, keys, true));
  write(join(out, "docs", "integration.md"), integrationDoc(info, entries, keys, deps, true));
  write(join(out, "docs", "architecture.md"), architectureDoc(info));
  write(join(out, "docs", "verification.md"), verificationDoc(info, true));
  for (const [name, text] of Object.entries(info.docs ?? {}))
    write(join(out, "docs", name), productText(text));
  write(join(out, "agent", "INTEGRATE.md"), agentDoc(info, entries, keys, true));
  write(join(out, "LICENSES", "README.md"), licensesDoc(info));
  return out;
}

/** A certified catalog component as found on disk (catalog/components/<id>). */
export interface ComponentSource extends PackageComponent {
  dir: string;
  does: string;
}

/** Package of components only (no complete use case): native modules, curated integration code, contract tests. */
export function writeComponentPackage(
  components: ComponentSource[],
  outRoot: string,
  info: PackageInfo,
): string {
  const out = join(outRoot, info.slug);
  mkdirSync(out, { recursive: true });
  const deps: Record<string, string> = {};
  const envLines: string[] = [];
  const examples: string[] = [];
  for (const c of components) {
    const files = join(c.dir, "files");
    if (existsSync(files)) {
      cpSync(files, out, {
        recursive: true,
        filter: (src) => !src.endsWith("nav.json") && !src.endsWith(".env.example.append"),
      });
      const append = join(files, ".env.example.append");
      if (existsSync(append)) envLines.push(readFileSync(append, "utf8").trim());
    }
    const glue = join(c.dir, "glue.ts");
    if (existsSync(glue))
      write(
        join(out, "src", "integrations", `${c.capability.replace(/\./g, "-")}.ts`),
        readFileSync(glue, "utf8"),
      );
    const contract = join(c.dir, "contract.test.ts");
    if (existsSync(contract))
      write(join(out, "tests", `${c.id}.test.ts`), readFileSync(contract, "utf8"));
    const npm = /^pkg:npm\/(.+)@([^@]+)$/.exec(c.purl);
    if (npm?.[1] && npm[2]) deps[decodeURIComponent(npm[1])] = npm[2];
    examples.push(
      `## ${c.capability} — \`${c.id}\`\n\n${c.does}\n\nSee \`tests/${c.id}.test.ts\` for a working example.`,
    );
  }
  write(join(out, "examples", "README.md"), `# Examples\n\n${examples.join("\n\n")}\n`);
  const env = envLines.join("\n");
  write(join(out, "config", ".env.example"), env ? `${env}\n` : "");
  const all = trackedFiles(out);
  const keys = envKeys(env);
  const entries = entryPoints(all.map((f) => f));
  write(
    join(out, "manifest.json"),
    `${JSON.stringify(manifest(info, deps, keys, entries), null, 2)}\n`,
  );
  write(join(out, "README.md"), readme(info, entries, keys, false));
  write(join(out, "docs", "integration.md"), integrationDoc(info, entries, keys, deps, false));
  write(join(out, "docs", "architecture.md"), architectureDoc(info));
  write(join(out, "docs", "verification.md"), verificationDoc(info, false));
  write(join(out, "agent", "INTEGRATE.md"), agentDoc(info, entries, keys, false));
  write(join(out, "LICENSES", "README.md"), licensesDoc(info));
  return out;
}
