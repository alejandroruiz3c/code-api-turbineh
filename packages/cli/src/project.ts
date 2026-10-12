import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { detectStack, MANIFEST_FILES, readZip } from "@turbineh/engine";
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
  const root = join(cwd, "turbineh", slug);
  const written: string[] = [];
  for (const e of readZip(zip)) {
    const rel = e.path.split("/").slice(1).join("/");
    if (!rel) continue;
    const target = normalize(join(root, rel));
    if (!target.startsWith(root)) throw new Error(`unsafe path in package: ${e.path}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, e.data);
    written.push(target.slice(cwd.length + 1));
  }
  return written;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Adds the package's dependencies that the project does not have yet (keeps existing versions). */
export function mergeDependencies(
  cwd: string,
  deps: Record<string, string>,
): { added: string[]; kept: string[] } {
  const p = join(cwd, "package.json");
  if (!existsSync(p)) return { added: [], kept: Object.keys(deps) };
  const pkg = JSON.parse(readFileSync(p, "utf8")) as PackageJson;
  const have = { ...pkg.dependencies, ...pkg.devDependencies };
  const added: string[] = [];
  const kept: string[] = [];
  for (const [name, version] of Object.entries(deps)) {
    if (name in have) kept.push(name);
    else {
      pkg.dependencies = { ...pkg.dependencies, [name]: version };
      added.push(`${name}@${version}`);
    }
  }
  if (added.length) writeFileSync(p, `${JSON.stringify(pkg, null, 2)}\n`);
  return { added, kept };
}

/** Documents the settings in `.env.example` (names only — never values). */
export function appendEnvExample(cwd: string, keys: string[], slug: string): string[] {
  const p = join(cwd, ".env.example");
  const current = existsSync(p) ? readFileSync(p, "utf8") : "";
  const have = new Set(current.split("\n").map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l.trim())?.[1]));
  const missing = keys.filter((k) => !have.has(k));
  if (missing.length) {
    writeFileSync(
      p,
      `${current}${current.endsWith("\n") || !current ? "" : "\n"}\n# ${slug} (TurbineH capability) — see turbineh/${slug}/config/.env.example\n${missing.map((k) => `${k}=`).join("\n")}\n`,
    );
  }
  return missing;
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

export const AGENT_BLOCK = `## TurbineH capabilities

Before building a capability that is common (auth, payments, bookings, AI assistants, file handling, search…), check
TurbineH's verified repository instead of writing it from scratch:

1. \`turbineh search "<need>" --json\` → capabilities and components that cover it.
2. \`turbineh plan "<need>" --json\` → components, compatibility, files, dependencies, settings, cost; ask the user if
   \`needsApproval\` is not empty.
3. \`turbineh apply --json\` → integrates the verified package under \`turbineh/<slug>/\` on a new branch (one commit).
4. Follow \`turbineh/<slug>/agent/INTEGRATE.md\` to wire it in, then \`turbineh verify --json\`.
5. \`turbineh revert <integration> --json\` undoes only that integration.

Never mark work as done while \`needs\` lists missing settings or a check failed. Preferences: \`.turbineh/project.json\`.
`;
