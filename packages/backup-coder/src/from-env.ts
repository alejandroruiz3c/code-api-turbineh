import type { Env } from "@turbineh/shared";
import { BackupCoder, type CoderSlot } from "./backup-coder.js";

function slot(ref?: string, baseURL?: string, apiKey?: string): CoderSlot | undefined {
  return ref && baseURL ? { ref, baseURL, apiKey: apiKey ?? "none" } : undefined;
}

/** The Backup Coder is not optional: both slots must be configured or this throws. */
export function backupCoderFromEnv(env: Env): BackupCoder {
  const primary = slot(
    env.BACKUP_CODER_PRIMARY,
    env.BACKUP_CODER_PRIMARY_BASE_URL,
    env.BACKUP_CODER_PRIMARY_API_KEY,
  );
  const secondary = slot(
    env.BACKUP_CODER_SECONDARY,
    env.BACKUP_CODER_SECONDARY_BASE_URL,
    env.BACKUP_CODER_SECONDARY_API_KEY,
  );
  const missing = [
    !primary && "BACKUP_CODER_PRIMARY(+_BASE_URL)",
    !secondary && "BACKUP_CODER_SECONDARY(+_BASE_URL)",
  ].filter(Boolean);
  if (!primary || !secondary) throw new Error(`Backup Coder not configured: ${missing.join(", ")}`);
  return new BackupCoder(primary, secondary);
}
