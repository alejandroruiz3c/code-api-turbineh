import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { recordGap, type BackupCoder, type Trigger } from "@turbineh/backup-coder";
import { CODE_RULES, type Usage } from "./model.js";

/**
 * Policy (code): the Backup Coder only fills self-contained helper capabilities. Sign-in, authorization, security,
 * payments, email and UI gaps are never generated — they are reported to the user instead.
 */
const FILLABLE = ["data.", "files.", "ops.", "jobs."];
export const isFillable = (capability: string) => FILLABLE.some((p) => capability.startsWith(p));

export interface GapToFill {
  capability: string;
  label: string;
  trigger: Extract<Trigger, "T1" | "T2">;
}

export interface FilledGap {
  capability: string;
  trigger: Trigger;
  module: string;
  test: string;
  model: string;
  failedOver: boolean;
  usage: Usage;
  record: string;
}

export const backupFile = (capability: string) => `src/backup/${capability.replace(/\./g, "-")}.ts`;
const testFile = (capability: string) =>
  `tests/unit/backup/${capability.replace(/\./g, "-")}.test.ts`;

/**
 * Two small calls per gap (ADR-0010): the module, then its unit test written against that module. Both pass the
 * same verification as the rest of the app; the gap is recorded in catalog/gaps/ (flywheel).
 */
export async function fillGap(
  dir: string,
  gap: GapToFill,
  coder: BackupCoder,
  ctx: { buildId: string; summary: string; allowedImports: string[]; gapsDir: string },
): Promise<FilledGap> {
  const moduleRel = backupFile(gap.capability);
  const request = {
    buildId: ctx.buildId,
    trigger: gap.trigger,
    capability: gap.capability,
    context: { buildSpec: { summary: ctx.summary } },
    instructions:
      `Write the module ${moduleRel}: small, pure, typed helper functions for "${gap.label}" in this app. ` +
      `Named exports only, JSDoc on each export. Allowed imports: ${ctx.allowedImports.join(", ")} and node: built-ins. ` +
      "No side effects at import time, no network, no environment variables. " +
      CODE_RULES,
    maxOutputTokens: 2500,
  };
  const mod = await coder.fill(request);
  writeAt(dir, moduleRel, mod.code);
  const importPath = `@/${moduleRel.slice(4).replace(/\.ts$/, "")}`;
  const test = await coder.fill({
    ...request,
    context: { contracts: [mod.code] },
    instructions:
      `Write a vitest unit test file for the module imported as "${importPath}" (given in contracts). ` +
      'Import { describe, expect, it } from "vitest". 2 to 4 focused tests of the exported functions, using only ' +
      "their exported signatures (no casts). No network, no timers, deterministic dates. " +
      CODE_RULES,
    maxOutputTokens: 1500,
  });
  writeAt(dir, testFile(gap.capability), test.code);
  const record = recordGap(ctx.gapsDir, request, mod);
  return {
    capability: gap.capability,
    trigger: gap.trigger,
    module: moduleRel,
    test: testFile(gap.capability),
    model: mod.model,
    failedOver: mod.failedOver,
    usage: {
      input_tokens: mod.usage.input_tokens + test.usage.input_tokens,
      output_tokens: mod.usage.output_tokens + test.usage.output_tokens,
    },
    record,
  };
}

function writeAt(dir: string, rel: string, code: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), code);
}
