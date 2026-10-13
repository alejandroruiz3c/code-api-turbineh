import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  appendEnvExampleText,
  detectStack,
  MANIFEST_FILES,
  mergeDependenciesText,
  packageFiles,
} from "@turbineh/engine";
import type { DetectedStack } from "@turbineh/shared";

/** Manifests only (never source code or secrets): what planning needs to understand the stack. */
export function localManifests(cwd: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of MANIFEST_FILES) {
    const p = join(cwd, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    if (text.length <= 400_000) files[f] = text;
  }
  return files;
}

export const localStack = (cwd: string): DetectedStack =>
  detectStack({ files: localManifests(cwd) });

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
}

export const isGitRepo = (cwd: string) => {
  try {
    return git(cwd, "rev-parse", "--is-inside-work-tree") === "true";
  } catch {
    return false;
  }
};

/** Clean apart from TurbineH's own project file (preferences and integration records are not part of the change). */
export const isClean = (cwd: string) =>
  git(cwd, "status", "--porcelain", "--", ".", ":(exclude).turbineh").length === 0;

/** Writes the package files under `turbineh/<slug>/`, refusing paths that escape it. */
export function extractPackage(cwd: string, zip: Buffer, slug: string): string[] {
  return packageFiles(zip, slug).map((f) => {
    const target = join(cwd, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.data);
    return f.path;
  });
}

/** Adds the package's dependencies that the project does not have yet (keeps existing versions). */
export function mergeDependencies(
  cwd: string,
  deps: Record<string, string>,
): { added: string[]; kept: string[] } {
  const p = join(cwd, "package.json");
  const r = mergeDependenciesText(existsSync(p) ? readFileSync(p, "utf8") : null, deps);
  if (r.added.length && r.text) writeFileSync(p, r.text);
  return { added: r.added, kept: r.kept };
}

/** Documents the settings in `.env.example` (names only — never values). */
export function appendEnvExample(cwd: string, keys: string[], slug: string): string[] {
  const p = join(cwd, ".env.example");
  const r = appendEnvExampleText(existsSync(p) ? readFileSync(p, "utf8") : "", keys, slug);
  if (r.missing.length) writeFileSync(p, r.text);
  return r.missing;
}

/** Settings missing in the local environment files (values are never read out, only presence). */
export function missingEnv(cwd: string, keys: string[]): string[] {
  const present = new Set<string>(Object.keys(process.env));
  for (const f of [".env", ".env.local", ".env.development.local"]) {
    const p = join(cwd, f);
    if (!existsSync(p)) continue;
    for (const l of readFileSync(p, "utf8").split("\n")) {
      const m = /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(l.trim());
      if (m?.[1] && m[2]?.trim()) present.add(m[1]);
    }
  }
  return keys.filter((k) => !present.has(k));
}
