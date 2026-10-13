import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptPackage,
  analyseRepo,
  firstReadList,
  isReadable,
  loadFoundation,
  mergePackageJson,
  pickAppPath,
  secondReadList,
  type Adaptation,
  type AdaptedFile,
} from "@turbineh/engine";
import { git, isGitRepo } from "./project.js";

/**
 * `turbineh build` in an existing project (ADR-0036): the same adaptation as the GitHub integration (ADR-0034), run
 * locally — own folder in the project's source root, the project's aliases, database client and test runner, exact
 * dependency versions merged without touching existing ones, settings by name in `.env.example`, unrelated files
 * never touched. Glue that would need the adaptation model uses its deterministic fallback (no model runs here).
 */

declare const __TURBINEH_FOUNDATION__:
  | { foundation: Record<string, string>; versions: Record<string, string> }
  | undefined;

/** Security Pack basics and verified versions: embedded in the bundled CLI, read from the catalog in development. */
export function foundation(): {
  foundation: Record<string, string>;
  versions: Record<string, string>;
} {
  if (typeof __TURBINEH_FOUNDATION__ !== "undefined") return __TURBINEH_FOUNDATION__;
  const here = dirname(fileURLToPath(import.meta.url));
  return loadFoundation(join(here, "..", "..", "..", "catalog", "recipes", "saas-crud", "template"));
}

const SKIP = /(^|\/)(node_modules|\.next|dist|build|out|\.turbo|\.vercel|coverage|\.git)(\/|$)/;

/** The project's files (git's view when it is a repository: tracked + untracked, never ignored ones). */
export function projectPaths(cwd: string): string[] {
  if (isGitRepo(cwd)) {
    return git(cwd, "ls-files", "--cached", "--others", "--exclude-standard")
      .split("\n")
      .filter((p) => p && !SKIP.test(p));
  }
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (SKIP.test(r)) continue;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else out.push(r);
      if (out.length > 20_000) return;
    }
  };
  walk(cwd, "");
  return out;
}

/** Reads a project file for the analysis; env files with values, keys and credentials are never read. */
export const projectReader = (cwd: string) => (p: string) => {
  if (!isReadable(p) && !/(^|\/)\.env\.(example|sample)$/.test(p)) return null;
  const f = join(cwd, p);
  if (!existsSync(f) || !statSync(f).isFile() || statSync(f).size > 1_000_000) return null;
  return readFileSync(f, "utf8");
};

export function adaptLocally(
  cwd: string,
  zip: Buffer,
  planId: string,
  need: string,
): { adaptation: Adaptation; files: AdaptedFile[] } {
  const paths = projectPaths(cwd);
  const read = projectReader(cwd);
  const pick = (list: string[]) =>
    Object.fromEntries(
      list.map((p) => [p, read(p)]).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  const first = pick(firstReadList(paths));
  const appPath = pickAppPath(first);
  const second = pick(secondReadList(paths, appPath, first));
  const analysis = analyseRepo({
    repo: "local",
    ref: "HEAD",
    paths,
    files: { ...first, ...second },
    appPath,
  });
  const { foundation: f, versions } = foundation();
  const adaptation = adaptPackage({
    zip,
    analysis,
    read,
    foundation: f,
    versions,
    planId,
    need,
  });
  // Glue with a model contract uses its deterministic fallback here; its own dependencies are added only then.
  const fallbackDeps = adaptation.glue.flatMap((g) => g.fallbackDependencies);
  if (fallbackDeps.length) {
    const pkgPath = analysis.appPath ? `${analysis.appPath}/package.json` : "package.json";
    const existing = adaptation.steps
      .flatMap((s) => s.files)
      .find((x) => x.path === pkgPath && x.action === "modify");
    const current = existing ? String(existing.content) : read(pkgPath);
    if (current) {
      const m = mergePackageJson(current, fallbackDeps);
      if (m.added.length) {
        if (existing) existing.content = m.text;
        else
          adaptation.steps.push({
            key: "dependencies",
            message: "dependencies",
            files: [
              { path: pkgPath, content: m.text, action: "modify", why: "Dependencies" },
            ],
          });
        adaptation.dependencies.added.push(...m.added);
      }
    }
  }
  // One file per path (later steps win: e.g. package.json after the fallback merge).
  const byPath = new Map<string, AdaptedFile>();
  for (const s of adaptation.steps) for (const x of s.files) byPath.set(x.path, x);
  return { adaptation, files: [...byPath.values()] };
}
