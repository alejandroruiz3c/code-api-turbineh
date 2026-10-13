/**
 * The fix for each gate finding, by rule (ADR-0040 G4c): the same text in the gate's findings (turbineh.json) and in
 * `turbineh verify --full`, so a coding agent reads one instruction wherever it meets the finding. Deterministic.
 */
const FIXES: Record<string, string> = {
  "turbineh.no-eval":
    "Remove eval / new Function: parse data with JSON.parse or a Zod schema, or map inputs to fixed functions.",
  "turbineh.no-child-process":
    "Do not start processes from app code: call a library or an HTTP API instead; tooling belongs in scripts/ or tests/.",
  "turbineh.raw-sql-injection":
    "Use Drizzle query builders, or the sql`…` tag with ${value} placeholders (parameters), never sql.raw or string concatenation.",
  "turbineh.server-action-without-authz":
    'First line of the action: await requireMember() / requireAdmin() (members), await requireSession() (signed in, not yet a member), or export it as publicAction("<name>", { rateLimit, schema }, handler) for anonymous visitors (src/server/authz.ts). Own helpers count when named require*/assert*.',
  "turbineh.hardcoded-secret":
    "Remove the literal: declare the setting in src/env.ts (Zod, no .default() for a required one) and .env.example, put the value in .env.local; tests generate their secrets at runtime.",
  "turbineh.env-secret-literal":
    "No secret-shaped literal or default in src/env.ts: a required setting has no .default(); during `next build` the template fills missing ones with crypto.randomUUID() (NEXT_PHASE=phase-production-build); real values go in .env.local.",
  "turbineh.unsanitized-html":
    "Render text instead of HTML, or pass it through sanitizeHtml() (component security.sanitize-html) before dangerouslySetInnerHTML.",
  "turbineh.sensitive-logging":
    "Do not log passwords, tokens or keys: log an id or a redacted marker instead.",
  "turbineh.open-redirect":
    "Redirect only to a relative path you allow-list (e.g. startsWith('/') and not '//'), never to a URL taken from the request.",
  "turbineh.ai-direct-model-call":
    "Call models only through orchestrate()/embed() from src/lib/ai/orchestrator (component ai.orchestrator.turbineh).",
  "turbineh.ai-sdk-dependency":
    "Remove the model SDK from package.json; the orchestrator talks to the TurbineH AI gateway with plain requests.",
  gitleaks:
    "Remove the value and read it from .env.local through src/env.ts; tests generate secrets at runtime. If it was a real credential, rotate it. If it is committed, rewrite that commit before pushing: the gate scans the whole git history.",
  "licence-policy":
    "Replace the package with a permissively licensed alternative (MIT, Apache-2.0, BSD, ISC…); if it is an optional binary, exclude it with pnpm.ignoredOptionalDependencies, then pnpm install.",
  install: "Run `pnpm install` and commit pnpm-lock.yaml; versions must exist and resolve offline.",
  migrations: "Run `pnpm db:generate && pnpm db:migrate` and commit the migration in drizzle/.",
  typecheck: "Fix the type error at that line, then `pnpm typecheck`.",
  lint: "Fix the lint error at that line (or run `pnpm lint --fix`), then `pnpm lint`.",
  unit: "Fix the code or the unit test, then `pnpm exec vitest run <that test file>`.",
  test: "Fix the code or the unit test, then `pnpm exec vitest run <that test file>`.",
  build: "Fix the build error at that line, then `pnpm build`.",
  e2e: "Fix the flow or the spec, then `pnpm test:e2e <that spec>`.",
};

export function findingFix(rule: string): string {
  return FIXES[rule] ?? "Fix it at that line, then run `turbineh verify --full` again.";
}

/** Rule ids that have their own fix text (tests check every Semgrep rule has one). */
export const FIXED_RULES = Object.keys(FIXES);

export function advisoryFix(a: { id: string; pkg: string; scope: string }): string {
  const name = a.pkg.slice(0, a.pkg.lastIndexOf("@")) || a.pkg;
  return a.scope === "production"
    ? `Upgrade ${name} (directly or through the package that pulls it in) to a version that fixes ${a.id} (https://osv.dev/vulnerability/${a.id}), then pnpm install.`
    : `Development only (not shipped): upgrade ${name} when convenient (https://osv.dev/vulnerability/${a.id}).`;
}
