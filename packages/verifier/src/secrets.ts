import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Pre-commit secret scan for model-written files: gitleaks on each file before it enters git history (the
 * verification scans the whole history, so a leak can never be removed later). Returns the files that leak.
 */
export function leakingFiles(dir: string, files: string[]): string[] {
  return files.filter((f) => {
    const path = join(dir, f);
    if (!existsSync(path)) return false;
    const r = spawnSync("gitleaks", ["dir", path, "--no-banner", "--redact", "--exit-code", "1"], {
      encoding: "utf8",
    });
    // Exit 1 = leak found; a missing gitleaks binary must not silently pass.
    if (r.error) throw new Error(`gitleaks unavailable: ${r.error.message}`);
    return r.status === 1;
  });
}
