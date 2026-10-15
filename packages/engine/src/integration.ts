import { posix } from "node:path";
import { readZip } from "./zip.js";

/**
 * How a capability package lands in a project, shared by the CLI (local repository) and the repository integration
 * (pull request): the package under `turbineh/<slug>/`, only missing dependencies added, settings documented by name.
 */
export interface IntegrationFile {
  path: string;
  data: Buffer;
}

export interface PackageManifestView {
  slug: string;
  dependencies: Record<string, string>;
  environment: string[];
}

/** The package's files placed under `turbineh/<slug>/`; any path that escapes it is refused. */
export function packageFiles(zip: Buffer, slug: string): IntegrationFile[] {
  const root = `turbineh/${slug}`;
  const out: IntegrationFile[] = [];
  for (const e of readZip(zip)) {
    const rel = e.path.split("/").slice(1).join("/");
    if (!rel) continue;
    const path = posix.normalize(posix.join(root, rel));
    if (!path.startsWith(`${root}/`)) throw new Error(`unsafe path in package: ${e.path}`);
    out.push({ path, data: e.data });
  }
  return out;
}

/** The package's manifest.json (top level of the zip). */
export function packageManifest(zip: Buffer): PackageManifestView | null {
  const entry = readZip(zip).find(
    (e) => e.path.endsWith("/manifest.json") && e.path.split("/").length === 2,
  );
  if (!entry) return null;
  const m = JSON.parse(entry.data.toString("utf8")) as Partial<PackageManifestView>;
  return m.slug
    ? { slug: m.slug, dependencies: m.dependencies ?? {}, environment: m.environment ?? [] }
    : null;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Adds the dependencies the project does not have yet (keeps existing versions). `null` text → nothing to change. */
export function mergeDependenciesText(
  text: string | null,
  deps: Record<string, string>,
): { text: string | null; added: string[]; kept: string[] } {
  if (text === null) return { text: null, added: [], kept: Object.keys(deps) };
  const pkg = JSON.parse(text) as PackageJson;
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
  return { text: added.length ? `${JSON.stringify(pkg, null, 2)}\n` : text, added, kept };
}

/** Documents the settings in `.env.example` (names only — never values). */
export function appendEnvExampleText(
  current: string,
  keys: string[],
  slug: string,
): { text: string; missing: string[] } {
  const have = new Set(current.split("\n").map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l.trim())?.[1]));
  const missing = keys.filter((k) => !have.has(k));
  if (!missing.length) return { text: current, missing };
  const sep = current.endsWith("\n") || !current ? "" : "\n";
  return {
    text: `${current}${sep}\n# ${slug} (TurbineH capability) — see turbineh/${slug}/config/.env.example\n${missing.map((k) => `${k}=`).join("\n")}\n`,
    missing,
  };
}
