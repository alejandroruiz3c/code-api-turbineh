import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BackupCoder } from "@turbineh/backup-coder";
import { leakingFiles, type VerifyResult } from "@turbineh/verifier";
import {
  askFile,
  CODE_RULES,
  withHeader,
  withoutTurbinehHeader,
  type ModelCfg,
  type Usage,
} from "./model.js";

export const QUALITY_GATES = ["install", "migrations", "lint", "typecheck", "unit", "build", "e2e"];

/** True when a quality gate (not a security scan) fails: the corrector's job. */
export function qualityFailed(v: VerifyResult): boolean {
  return v.steps.some((s) => !s.ok && QUALITY_GATES.includes(s.name));
}

/** Failing quality-gate log, newest lines last, bounded so the context stays small. */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

export function failureLog(v: VerifyResult): string {
  return v.steps
    .filter((s) => !s.ok && QUALITY_GATES.includes(s.name))
    .map((s) => `[${s.name}]\n${s.detail.replace(ANSI, "").slice(-3000)}`)
    .join("\n");
}

/**
 * Files the corrector may touch: tracked files mentioned in the failing log that the system generated
 * (`// turbineh:generated…` header). Recipe code, catalog code and copied contract tests are never edited.
 */
export function correctableFiles(dir: string, log: string): string[] {
  const tracked = execFileSync("git", ["ls-files"], { cwd: dir })
    .toString()
    .split("\n")
    // Contract tests and the business-rule fixture tests (written by code) are oracles, and the related-record
    // loaders (written by code) carry the workspace scoping: never edited by a model.
    .filter(
      (f) =>
        /\.(ts|tsx)$/.test(f) &&
        !f.startsWith("tests/unit/components/") &&
        !f.endsWith(".fixtures.test.ts") &&
        !/^src\/entities\/[^/]+\/related\.ts$/.test(f),
    );
  // A failing generated test and the module it tests are corrected together (the bug may be in either).
  const mentioned = new Set(tracked.filter((f) => log.includes(f)));
  for (const f of tracked.filter((x) => log.includes(x))) {
    const m = /^tests\/unit\/backup\/(.+)\.test\.ts$/.exec(f);
    if (m && tracked.includes(`src/backup/${m[1]}.ts`)) mentioned.add(`src/backup/${m[1]}.ts`);
  }
  for (const m of log.matchAll(/tests\/unit\/rules\/([a-z0-9-]+)(?:\.fixtures)?\.test\.ts/g)) {
    const rules = `src/entities/${m[1]}/rules.ts`;
    if (tracked.includes(rules)) mentioned.add(rules);
  }
  return tracked.filter((f) => {
    if (!mentioned.has(f)) return false;
    const head = readFileSync(join(dir, f), "utf8").split("\n", 3).join("\n");
    return /\/\/ turbineh:generated/.test(head);
  });
}

const PATCH_SYSTEM = `You fix ONE file of a TypeScript/Next.js app so that the failing quality gate passes.
Change only what the error log reports for this file, with the smallest edit. Keep exports, behaviour, validation,
authorization checks and the "use server"/"use client" directive (first statement). Never add secrets.`;

export interface CorrectionStep {
  attempt: number;
  by: string;
  trigger?: "T4";
  files: string[];
  usage: Usage;
}

/** One directed patch round with the compiler model, all affected files in parallel. Returns null if nothing to do. */
export async function patchOnce(
  dir: string,
  v: VerifyResult,
  cfg: ModelCfg,
  attempt: number,
): Promise<CorrectionStep | null> {
  const log = failureLog(v);
  const files = correctableFiles(dir, log);
  if (files.length === 0) return null;
  const usage: Usage = { input_tokens: 0, output_tokens: 0 };
  const changed: string[] = [];
  await Promise.all(
    files.map(async (f) => {
      const before = readFileSync(join(dir, f), "utf8");
      const header = before.split("\n")[0] ?? "// turbineh:generated";
      const r = await askFile(cfg, PATCH_SYSTEM, {
        file: f,
        error_log: log,
        content: before,
      }).catch(() => null);
      if (!r) return;
      usage.input_tokens += r.usage.input_tokens;
      usage.output_tokens += r.usage.output_tokens;
      const after = withHeader(header, r.content);
      if (after.trimEnd() === before.trimEnd()) return;
      writeFileSync(join(dir, f), after);
      changed.push(f);
    }),
  );
  const kept = dropLeaks(dir, changed);
  if (kept.length === 0) return null;
  changed.splice(0, changed.length, ...kept);
  commit(dir, `fix: directed correction ${attempt} (${changed.length} file(s))`);
  return { attempt, by: cfg.model, files: changed, usage };
}

/** T4: correction loop exhausted and swap failed — the Backup Coder patches the same files, minimal context. */
export async function backupPatch(
  dir: string,
  v: VerifyResult,
  coder: BackupCoder,
  buildId: string,
  attempt: number,
): Promise<CorrectionStep | null> {
  const log = failureLog(v);
  const files = correctableFiles(dir, log);
  if (files.length === 0) return null;
  const usage: Usage = { input_tokens: 0, output_tokens: 0 };
  const changed: string[] = [];
  let model = "";
  await Promise.all(
    files.map(async (f) => {
      const before = readFileSync(join(dir, f), "utf8");
      const r = await coder
        .fill({
          buildId,
          trigger: "T4",
          capability: `fix:${f}`,
          context: { contracts: [withoutTurbinehHeader(before)], error: log },
          instructions: `Return the full corrected content of ${f} so the failing gate passes. Smallest change. ${CODE_RULES}`,
          maxOutputTokens: 6000,
        })
        .catch(() => null);
      if (!r) return;
      model = r.model;
      usage.input_tokens += r.usage.input_tokens;
      usage.output_tokens += r.usage.output_tokens;
      writeFileSync(join(dir, f), r.code);
      changed.push(f);
    }),
  );
  const kept = dropLeaks(dir, changed);
  if (kept.length === 0) return null;
  changed.splice(0, changed.length, ...kept);
  commit(dir, `fix: backup coder correction (T4, ${changed.length} file(s))`);
  return { attempt, by: model, trigger: "T4", files: changed, usage };
}

/** Model-written changes that look like secrets are reverted before they can reach git history. */
function dropLeaks(dir: string, files: string[]): string[] {
  const leaks = leakingFiles(dir, files);
  for (const f of leaks) execFileSync("git", ["checkout", "--", f], { cwd: dir });
  return files.filter((f) => !leaks.includes(f));
}

/** Commits a correction (migrations first, in their own commit). Exported for tests. */
export function commit(dir: string, message: string): void {
  if (!existsSync(join(dir, ".git"))) return;
  // Migrations generated from the schema during verification belong in the app (deploys apply them), but in their
  // own commit so a correction's history shows only what the correction changed.
  const migrations = execFileSync("git", ["status", "--porcelain", "--", "drizzle"], {
    cwd: dir,
    encoding: "utf8",
  });
  if (migrations.trim()) {
    execFileSync("git", ["add", "--", "drizzle"], { cwd: dir });
    gitCommit(dir, "chore(db): migrations generated from the schema");
  }
  execFileSync("git", ["add", "-A"], { cwd: dir });
  gitCommit(dir, message);
}

function gitCommit(dir: string, message: string): void {
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
      message,
    ],
    { cwd: dir },
  );
}
