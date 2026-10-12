import { execFileSync } from "node:child_process";
import type { Decider } from "@turbineh/decider";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leakingFiles, sandbox, type StaticFinding, type VerifyResult } from "@turbineh/verifier";
import OpenAI from "openai";
import { z } from "zod";
import { findingKey, isAiReroute, triageFindings } from "./triage.js";

/** A model slot for the security specialist (OpenAI-compatible endpoint serving an open-weights model). */
export interface FixerSlot {
  model: string;
  baseURL: string;
  apiKey: string;
}

export interface RemediationChange {
  kind: "dependency" | "code";
  target: string;
  reason: string;
  detail: string;
}

export interface RemediationOptions {
  fixers: FixerSlot[];
  /**
   * auto: every static finding (errors and warnings) and every production-dependency advisory — always run before
   * delivery. improve: everything, including development-only advisories — run when the user asks for it.
   */
  scope: "auto" | "improve";
  reasoningEffort?: string;
  /** Routes findings in one batched request before fixing (optional; without it every finding is attempted). */
  decider?: Decider;
}

type Advisory = VerifyResult["findings"]["advisories"][number];

export const FIX_MARKER = "// turbineh:security-fix";

const SYSTEM = `You are an application-security engineer fixing ONE TypeScript/Next.js file.
Fix exactly the reported findings with the smallest safe change. Keep behaviour, exports, imports that are still used,
and the "use server"/"use client" directive (it must stay the first statement). Prefer existing helpers:
requireMember()/can() from "@/server/authz", rateLimit() from "@/security/rate-limit", Zod schemas, Drizzle query
builders (never raw SQL strings), environment variables via "@/env". Never add secrets.
Return JSON only: {"content": "<the full corrected file>"}.`;

const FixedFile = z.object({ content: z.string().min(1) });

/** Advisories in scope for a remediation level. */
function advisoriesInScope(v: VerifyResult, scope: RemediationOptions["scope"]) {
  return v.findings.advisories.filter((a) => scope === "improve" || a.scope === "production");
}

export function needsRemediation(v: VerifyResult, scope: RemediationOptions["scope"]): boolean {
  return v.findings.static.length > 0 || advisoriesInScope(v, scope).length > 0;
}

/** OSV "fixed" version for an advisory affecting `name` (highest fixed event), if any. */
export async function fixedVersion(id: string, name: string): Promise<string | null> {
  const res = await fetch(`https://api.osv.dev/v1/vulns/${id}`);
  if (!res.ok) return null;
  const v = (await res.json()) as {
    affected?: { package?: { name?: string }; ranges?: { events?: { fixed?: string }[] }[] }[];
  };
  const fixes = (v.affected ?? [])
    .filter((a) => a.package?.name === name)
    .flatMap((a) =>
      (a.ranges ?? []).flatMap((r) =>
        (r.events ?? []).map((e) => e.fixed).filter((x): x is string => Boolean(x)),
      ),
    );
  const cmp = (a: string, b: string) => {
    const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
    const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++)
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    return 0;
  };
  return fixes.sort(cmp).pop() ?? null;
}

/** Deterministic dependency remediation: pin patched versions through pnpm overrides and refresh the lockfile. */
async function fixDependencies(dir: string, advisories: Advisory[]): Promise<RemediationChange[]> {
  const changes: RemediationChange[] = [];
  const overrides: Record<string, string> = {};
  for (const a of advisories) {
    const at = a.pkg.lastIndexOf("@");
    const name = a.pkg.slice(0, at);
    const fixed = await fixedVersion(a.id, name);
    if (!fixed) continue;
    // Range selector: only vulnerable versions are lifted; newer copies used by other packages stay untouched.
    overrides[`${name}@<${fixed}`] = fixed;
    changes.push({
      kind: "dependency",
      target: `${name} → ${fixed}`,
      reason: a.id,
      detail: `${a.severity} advisory in ${a.pkg} (${a.scope})`,
    });
  }
  if (Object.keys(overrides).length === 0) return [];
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    pnpm?: { overrides?: Record<string, string> };
  };
  pkg.pnpm = { ...pkg.pnpm, overrides: { ...pkg.pnpm?.overrides, ...overrides } };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  // Lockfile refresh is the only networked step (package registry), inside the sandbox, without secrets.
  const r = await sandbox(dir, "pnpm install --lockfile-only && pnpm fetch", {
    network: "bridge",
    env: {},
  });
  if (r.code !== 0) throw new Error(`lockfile refresh failed: ${r.tail.slice(-400)}`);
  return changes;
}

async function askFixer(
  opts: RemediationOptions,
  file: string,
  content: string,
  findings: StaticFinding[],
): Promise<string> {
  const payload = JSON.stringify({
    file,
    findings: findings.map((f) => ({
      rule: f.rule,
      line: f.line,
      problem: f.message,
      why_it_matters: f.explain,
    })),
    content,
  });
  let last: unknown;
  for (const slot of opts.fixers) {
    try {
      const client = new OpenAI({
        baseURL: slot.baseURL,
        apiKey: slot.apiKey,
        timeout: 120_000,
        maxRetries: 1,
      });
      const res = await client.chat.completions.create({
        model: slot.model,
        temperature: 0,
        max_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: payload },
        ],
        ...(opts.reasoningEffort
          ? { reasoning_effort: opts.reasoningEffort as OpenAI.ReasoningEffort }
          : {}),
      });
      const parsed = FixedFile.parse(JSON.parse(res.choices[0]?.message.content ?? "{}"));
      return parsed.content;
    } catch (err) {
      last = err;
    }
  }
  throw new Error(`security fixer unavailable: ${String(last)}`);
}

/**
 * Instructions for a direct model call (owner decision, ADR-0029: reroute instead of blocking). With the orchestrator
 * in the app the call is rewritten to it, so the AI Safety Pack, the TurbineH gateway, quotas, usage and audit apply;
 * without it the call is disabled with a clear error rather than shipped unrouted.
 */
export function aiRerouteGuidance(dir: string): string {
  return existsSync(join(dir, "src/lib/ai/orchestrator.ts"))
    ? 'This code calls an AI model or SDK directly. Rewrite it to use the app\'s orchestrator instead: import { orchestrate, embed } from "@/lib/ai/orchestrator". ' +
        'Chat/completion → `const r = await orchestrate({ organizationId, userId, purpose: "<short label>", task: "<what the app wants>", input: <user text or record>, schema?: <zod schema for structured output> })` and use `r.text` (or `r.output` with a schema). ' +
        'Embeddings → `await embed(texts, { organizationId, userId, purpose: "<label>" })` returning number[][]. Take organizationId/userId from the existing session helpers (require*). ' +
        "Remove the direct SDK import, client construction, API keys and fetch calls to model endpoints. Keep the function signature and behaviour for callers."
    : 'This code calls an AI model or SDK directly and this app has no TurbineH orchestrator. Disable the call safely: remove the SDK import, client and any API key usage, and make the function throw new Error("This AI feature is not available: AI calls must go through TurbineH.") instead. Keep the function signature so the app still compiles.';
}

/** Code remediation: one specialist call per affected file, minimal context, all files in parallel. */
async function fixCode(
  dir: string,
  findings: StaticFinding[],
  opts: RemediationOptions,
): Promise<RemediationChange[]> {
  const byFile = new Map<string, StaticFinding[]>();
  const guidance = aiRerouteGuidance(dir);
  for (const f of findings) {
    // A direct model call gets exact instructions: reroute through the orchestrator (or disable it if the app has none).
    const g = isAiReroute(f) ? { ...f, message: guidance, explain: guidance } : f;
    byFile.set(f.path, [...(byFile.get(f.path) ?? []), g]);
  }
  const perFile = await Promise.all(
    [...byFile].map(async ([file, fs]): Promise<RemediationChange[]> => {
      const p = join(dir, file);
      if (!existsSync(p)) return [];
      const before = readFileSync(p, "utf8");
      if (before.split("\n").length > 600) return []; // keep the specialist on small, reviewable units
      const after = (await askFixer(opts, file, before, fs))
        .replace(new RegExp(`\\n?${FIX_MARKER}.*$`, "m"), "")
        .trimEnd();
      if (!after || after === before.trimEnd()) return [];
      writeFileSync(
        p,
        `${after}\n${FIX_MARKER} ${[...new Set(fs.map((f) => f.rule))].join(", ")}\n`,
      );
      return fs.map((f) => ({
        kind: "code" as const,
        target: `${file}:${f.line}`,
        reason: f.rule,
        detail: f.message,
      }));
    }),
  );
  return perFile.flat();
}

/**
 * One remediation round. The caller re-runs the full verification afterwards; nothing is delivered on the basis of
 * the fixer's own claims.
 */
export async function remediateOnce(
  dir: string,
  v: VerifyResult,
  opts: RemediationOptions,
): Promise<RemediationChange[]> {
  const deps = advisoriesInScope(v, opts.scope);
  const routes = await triageFindings(v.findings.static, opts.decider);
  const code = v.findings.static.filter((f) => routes.get(findingKey(f)) !== "human");
  // Dependency pins and code fixes touch different files: run them at the same time.
  const [depChanges, codeChanges] = await Promise.all([
    fixDependencies(dir, deps),
    fixCode(dir, code, opts),
  ]);
  // Specialist-written files that look like secrets are reverted (they would stay in git history forever).
  const files = [...new Set(codeChanges.map((c) => c.target.split(":")[0] ?? ""))].filter(Boolean);
  const leaks = new Set(leakingFiles(dir, files));
  for (const f of leaks) execFileSync("git", ["checkout", "--", f], { cwd: dir });
  const changes = [
    ...depChanges,
    ...codeChanges.filter((c) => !leaks.has(c.target.split(":")[0] ?? "")),
  ];
  if (changes.length > 0) {
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=CODE-API-TURBINEH",
        "-c",
        "user.email=builds@turbineh.com",
        "commit",
        "-q",
        "-m",
        `fix(security): ${changes.length} automated remediation(s)`,
      ],
      { cwd: dir },
    );
  }
  return changes;
}

const REPAIR_SYSTEM = `You are a senior TypeScript/Next.js engineer. A security fix was just applied to this file and one of
the quality gates (lint, typecheck, build, unit or end-to-end tests) now fails. Fix ONLY what the error log reports for
this file (for example unused imports or type errors) with the smallest change. Do NOT reintroduce eval, raw SQL
strings, unsanitized HTML, missing authorization checks or hardcoded secrets. Keep the "use server"/"use client"
directive first. Return JSON only: {"content": "<the full corrected file>"}.`;

/**
 * Repairs files that a security remediation changed when a quality gate fails afterwards. Only files the
 * remediation touched are edited; the caller re-runs the full verification.
 */
export async function repairAfterRemediation(
  dir: string,
  v: VerifyResult,
  changedFiles: string[],
  opts: RemediationOptions,
): Promise<RemediationChange[]> {
  const failing = v.steps.filter(
    (x) => !x.ok && ["lint", "typecheck", "build", "unit", "e2e"].includes(x.name),
  );
  if (failing.length === 0 || changedFiles.length === 0) return [];
  const log = failing.map((x) => `[${x.name}]\n${x.detail.slice(-2500)}`).join("\n");
  const changes: RemediationChange[] = [];
  for (const file of changedFiles) {
    const p = join(dir, file);
    if (!existsSync(p)) continue;
    const before = readFileSync(p, "utf8");
    const relevant = log.includes(file) ? log : "";
    if (!relevant) continue;
    const payload = JSON.stringify({ file, error_log: relevant, content: before });
    let fixed: string | null = null;
    for (const slot of opts.fixers) {
      try {
        const client = new OpenAI({
          baseURL: slot.baseURL,
          apiKey: slot.apiKey,
          timeout: 120_000,
          maxRetries: 1,
        });
        const res = await client.chat.completions.create({
          model: slot.model,
          temperature: 0,
          max_tokens: 8000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: REPAIR_SYSTEM },
            { role: "user", content: payload },
          ],
          ...(opts.reasoningEffort
            ? { reasoning_effort: opts.reasoningEffort as OpenAI.ReasoningEffort }
            : {}),
        });
        fixed = FixedFile.parse(JSON.parse(res.choices[0]?.message.content ?? "{}")).content;
        break;
      } catch {
        continue;
      }
    }
    if (!fixed || fixed.trimEnd() === before.trimEnd()) continue;
    const marker = before.match(new RegExp(`${FIX_MARKER}.*$`, "m"))?.[0] ?? "";
    const body = fixed.replace(new RegExp(`\\n?${FIX_MARKER}.*$`, "m"), "").trimEnd();
    writeFileSync(p, `${body}\n${marker}\n`);
    changes.push({
      kind: "code",
      target: file,
      reason: "repair",
      detail: `quality gate fixed after security remediation (${failing.map((x) => x.name).join(", ")})`,
    });
  }
  const repairLeaks = new Set(
    leakingFiles(
      dir,
      changes.map((c) => c.target),
    ),
  );
  for (const f of repairLeaks) execFileSync("git", ["checkout", "--", f], { cwd: dir });
  changes.splice(0, changes.length, ...changes.filter((c) => !repairLeaks.has(c.target)));
  if (changes.length > 0) {
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=CODE-API-TURBINEH",
        "-c",
        "user.email=builds@turbineh.com",
        "commit",
        "-q",
        "-m",
        "fix: repair quality gates after security remediation",
      ],
      { cwd: dir },
    );
  }
  return changes;
}
