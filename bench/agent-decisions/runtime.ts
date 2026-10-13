/**
 * Loads the real runAgent runtime of the orchestrator component (catalog/components/ai.orchestrator.turbineh) outside
 * an assembled app: the component's files are copied into a scratch folder (git-ignored) with the app-only modules
 * (database, rate limit, usage records) replaced by no-ops. `ref` = "worktree" uses the files on disk; any git ref
 * (e.g. "origin/main") loads that revision, so before/after runs execute the exact code being compared.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");
const ORCH = "catalog/components/ai.orchestrator.turbineh/files/src/lib/ai";
const SAFETY = "catalog/components/security.ai-safety.turbineh/files/src/lib/ai";
const ERRORS = "catalog/recipes/saas-crud/template/src/security/errors.ts";

const read = (ref: string, path: string): string =>
  ref === "worktree"
    ? readFileSync(join(root, path), "utf8")
    : execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8" });

/** No-op stand-ins for the app's database, rate limit and usage modules (limits and audit are app concerns). */
const STUB_SAFETY = `export * from "./guard";
export interface AiCaller { organizationId: string; userId: string | null }
export async function checkLimits(_c: AiCaller): Promise<void> {}
export async function audit(_e: unknown): Promise<void> {}
`;
const STUB_ORCHESTRATOR = `export async function recordUsage(..._args: unknown[]): Promise<void> {}
`;

/** The parts of agent.ts the bench uses (typed locally: the component's files only type-check inside an app). */
export interface AgentTool {
  name: string;
  description: string;
  parameters: unknown;
  irreversible?: boolean;
  prepare?: (args: never, ctx: unknown) => Promise<{ summary: string }>;
  execute: (args: never, ctx: unknown) => Promise<unknown>;
}
export interface AgentResult {
  status: string;
  reply: string;
  pending: { id: string; tool: string; summary: string } | null;
  state: { messages: unknown[]; pending: unknown };
  steps: { tool: string; ok: boolean; executed: boolean }[];
  route: string;
  model: string;
  flags: string[];
  usage: { calls: number; inputTokens: number; outputTokens: number };
}
export interface AgentModule {
  runAgent: (req: Record<string, unknown>) => Promise<AgentResult>;
  ToolError: new (message: string) => Error;
}

export async function loadRuntime(ref: string): Promise<{ agent: AgentModule; dir: string }> {
  const dir = join(import.meta.dirname, ".runtime", ref.replace(/[^a-z0-9]+/gi, "-"));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const fix = (code: string) => code.replace(/["']@\/security\/errors["']/g, '"./errors"');
  for (const f of ["agent", "decider", "models", "plan"])
    writeFileSync(join(dir, `${f}.ts`), fix(read(ref, `${ORCH}/${f}.ts`)));
  writeFileSync(join(dir, "guard.ts"), fix(read(ref, `${SAFETY}/guard.ts`)));
  writeFileSync(join(dir, "errors.ts"), read(ref, ERRORS));
  writeFileSync(join(dir, "safety.ts"), STUB_SAFETY);
  writeFileSync(join(dir, "orchestrator.ts"), STUB_ORCHESTRATOR);
  const agent = (await import(join(dir, "agent.ts"))) as AgentModule;
  return { agent, dir };
}
