import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

/**
 * Loads `.env.local` from the repo root into `process.env` without overriding
 * variables that are already set. Secrets live only in that ignored file.
 */
export function loadLocalEnv(startDir: string = process.cwd()): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, ".env.local");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());

/** `<provider>:<model>` — e.g. `deepinfra:deepseek-ai/DeepSeek-V4.1-Flash`. */
const modelRef = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(/^[a-z0-9-]+:.+$/, "expected <provider>:<model>")
    .optional(),
);

export const envSchema = z.object({
  TYPESAFE_API_KEY: optionalString,
  DECIDER_PRIMARY: z.enum(["jev", "open"]).default("jev"),
  DECIDER_FALLBACK: z.enum(["jev", "open", "none"]).default("open"),
  OPEN_DECIDER_BASE_URL: optionalUrl,

  COMPILER_BASE_URL: z.url().default("http://127.0.0.1:11434/v1"),
  COMPILER_MODEL: z.string().default("gemma4:12b"),
  COMPILER_API_KEY: optionalString,
  /** Sent as `reasoning_effort` (e.g. "none") to compiler and backup coder; unset = provider default. */
  MODEL_REASONING_EFFORT: optionalString,

  BACKUP_CODER_PRIMARY: modelRef,
  BACKUP_CODER_PRIMARY_BASE_URL: optionalUrl,
  BACKUP_CODER_PRIMARY_API_KEY: optionalString,
  BACKUP_CODER_SECONDARY: modelRef,
  BACKUP_CODER_SECONDARY_BASE_URL: optionalUrl,
  BACKUP_CODER_SECONDARY_API_KEY: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
