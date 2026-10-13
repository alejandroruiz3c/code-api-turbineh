import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * File ownership of an assembled package (ADR-0037 §D2): which recipe, catalog component, generated entity or
 * post-assembly part (integration, Backup Coder fill, business rules) brought each file. The corrector uses it to
 * attribute a failing test to the component that owns it, so a correction never removes unrelated components; coding
 * agents can read it too ("which component owns this file?").
 *
 * Owners: `recipe:<id>`, `component:<id>`, `entity:<Name>`, `generated`, and after assembly `integration:<capability>`,
 * `backup:<capability>`, `rules:<capability>`.
 */
export const OWNERS_FILE = ".turbineh/owners.json";

export interface OwnersFile {
  schema: "turbineh.owners/v1";
  files: Record<string, string>;
}

const SKIP = new Set(["node_modules", ".next", ".git", ".turbineh"]);

/** Every file under `dir`, relative to it (skips dependencies, build output and git). */
export function relativeFiles(dir: string, root = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? relativeFiles(p, root) : [relative(root, p)];
  });
}

export function readOwners(outDir: string): Record<string, string> {
  const p = join(outDir, OWNERS_FILE);
  if (!existsSync(p)) return {};
  try {
    return (JSON.parse(readFileSync(p, "utf8")) as OwnersFile).files ?? {};
  } catch {
    return {};
  }
}

/** Merges owners into the package's owners file (later owners win: the last copy of a file is what ships). */
export function recordOwners(outDir: string, owners: Record<string, string>): void {
  const files = { ...readOwners(outDir), ...owners };
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const p = join(outDir, OWNERS_FILE);
  mkdirSync(dirname(p), { recursive: true });
  const body: OwnersFile = { schema: "turbineh.owners/v1", files: sorted };
  writeFileSync(p, `${JSON.stringify(body, null, 2)}\n`);
}

/** `owner` for every file a source directory brings into the package. */
export function ownersOf(
  sourceDir: string,
  owner: string,
  skip: (rel: string) => boolean = () => false,
) {
  return Object.fromEntries(
    relativeFiles(sourceDir)
      .filter((f) => !skip(f))
      .map((f) => [f, owner]),
  );
}
