import { backupCoderFromEnv, type BackupCoder } from "@turbineh/backup-coder";
import type { Env } from "@turbineh/shared";
import type { FixerSlot } from "@turbineh/remediation";
import type { WriterConfig } from "@turbineh/reporter";

const modelOf = (ref: string) => ref.slice(ref.indexOf(":") + 1);

/**
 * Security specialist: the best open code models we run (Backup Coder slots, ADR-0003) with a security-only prompt,
 * primary then secondary. Report writer: the best open writer available in the EU provider (ADR-0014).
 */
export function modelSlotsFromEnv(env: Env): {
  fixers: FixerSlot[];
  writer: WriterConfig;
  backupCoder: BackupCoder;
} {
  const fixers: FixerSlot[] = [];
  for (const [ref, url, key] of [
    [env.BACKUP_CODER_PRIMARY, env.BACKUP_CODER_PRIMARY_BASE_URL, env.BACKUP_CODER_PRIMARY_API_KEY],
    [
      env.BACKUP_CODER_SECONDARY,
      env.BACKUP_CODER_SECONDARY_BASE_URL,
      env.BACKUP_CODER_SECONDARY_API_KEY,
    ],
  ] as const) {
    if (ref && url) fixers.push({ model: modelOf(ref), baseURL: url, apiKey: key ?? "none" });
  }
  return {
    fixers,
    backupCoder: backupCoderFromEnv(env),
    writer: {
      baseURL: env.COMPILER_BASE_URL,
      apiKey: env.COMPILER_API_KEY ?? "none",
      model: process.env.REPORT_WRITER_MODEL ?? "glm-5.2",
      ...(env.MODEL_REASONING_EFFORT ? { reasoningEffort: env.MODEL_REASONING_EFFORT } : {}),
    },
  };
}
