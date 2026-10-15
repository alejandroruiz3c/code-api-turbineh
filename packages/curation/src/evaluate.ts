import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";

/** One entry of a curation batch (catalog/curation/*.yaml). */
export interface CurationEntry {
  id: string;
  package: string;
  category: string;
  provides: string[];
  does: string;
  does_not: string;
  use_cases: string[];
  /** Optional major version line to stay on (e.g. "8"). */
  major?: string;
  /** DefinitelyTyped package for libraries without bundled types (version picked like the library, ≥ 14 days). */
  types?: string;
  pros?: string[];
  cons?: string[];
}

interface NpmVersion {
  version: string;
  license?: string | { type?: string };
  dist: { integrity?: string };
  repository?: string | { url?: string };
  peerDependencies?: Record<string, string>;
  deprecated?: string;
}

/** Highest stable version published at least `minAgeDays` ago (ADR-0002). */
export async function pickVersion(
  pkg: string,
  now = new Date(),
  minAgeDays = 14,
  major?: string,
): Promise<NpmVersion & { published: string }> {
  const res = await fetch(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}`);
  if (!res.ok) throw new Error(`npm ${res.status} for ${pkg}`);
  const doc = (await res.json()) as {
    time: Record<string, string>;
    versions: Record<string, NpmVersion>;
  };
  const cutoff = new Date(now.getTime() - minAgeDays * 86_400_000).toISOString();
  const candidates = Object.entries(doc.time)
    .filter(
      ([v, t]) =>
        /^\d+\.\d+\.\d+$/.test(v) &&
        t <= cutoff &&
        !doc.versions[v]?.deprecated &&
        (!major || v.startsWith(`${major}.`)),
    )
    .map(([v]) => v)
    .sort((a, b) => {
      const [a0 = 0, a1 = 0, a2 = 0] = a.split(".").map(Number);
      const [b0 = 0, b1 = 0, b2 = 0] = b.split(".").map(Number);
      return a0 - b0 || a1 - b1 || a2 - b2;
    });
  const version = candidates[candidates.length - 1];
  if (!version) throw new Error(`no stable version of ${pkg} older than ${minAgeDays} days`);
  return {
    ...(doc.versions[version] as NpmVersion),
    published: (doc.time[version] ?? "").slice(0, 10),
  };
}

const SEVERITY: Record<string, "critical" | "high" | "medium" | "low"> = {
  CRITICAL: "critical",
  HIGH: "high",
  MODERATE: "medium",
  MEDIUM: "medium",
  LOW: "low",
};

/** OSV advisories for an exact version, with their real severity. */
export async function osvAdvisories(
  pkg: string,
  version: string,
): Promise<{ id: string; severity: string }[]> {
  const res = await fetch("https://api.osv.dev/v1/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ package: { name: pkg, ecosystem: "npm" }, version }),
  });
  const data = (await res.json()) as {
    vulns?: { id: string; database_specific?: { severity?: string } }[];
  };
  return (data.vulns ?? []).map((v) => ({
    id: v.id,
    severity: SEVERITY[v.database_specific?.severity ?? ""] ?? "medium",
  }));
}

const repoUrl = (r: NpmVersion["repository"]) => {
  const raw = typeof r === "string" ? r : r?.url;
  if (!raw) return undefined;
  return raw
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^github:/, "https://github.com/");
};

/**
 * Writes catalog/components/<id>/component.yaml with status `evaluated`: metadata and licence come from the
 * registry (origin maintainer), advisories from OSV (origin tested). Certification later flips it to approved.
 */
export async function evaluate(
  entry: CurationEntry,
  componentsDir: string,
  today: string,
): Promise<{
  id: string;
  version: string;
  license: string;
  advisories: { id: string; severity: string }[];
}> {
  const meta = await pickVersion(entry.package, new Date(), 14, entry.major);
  const license =
    typeof meta.license === "string" ? meta.license : (meta.license?.type ?? "UNKNOWN");
  const advisories = await osvAdvisories(entry.package, meta.version);
  const types = entry.types ? await pickVersion(entry.types, new Date(), 14) : null;
  const manifest = {
    schema: "turbineh.component/v0.1",
    id: entry.id,
    version: "0.1.0",
    status: "evaluated",
    category: entry.category,
    source: {
      purl: `pkg:npm/${entry.package}@${meta.version}`,
      repo: repoUrl(meta.repository) ?? `https://www.npmjs.com/package/${entry.package}`,
      ...(meta.dist.integrity ? { integrity: meta.dist.integrity } : {}),
    },
    capability: {
      does: entry.does,
      does_not: entry.does_not,
      use_cases: entry.use_cases,
      pros: entry.pros ?? [],
      cons: entry.cons ?? [],
      alternatives: [],
    },
    contract: {
      inputs: ["see contract.test.ts"],
      outputs: ["see contract.test.ts"],
      errors: ["see contract.test.ts"],
      limits: ["see contract.test.ts"],
    },
    compat: {
      runtime: "node@>=20",
      ...(Object.keys(meta.peerDependencies ?? {}).length ? { peer: meta.peerDependencies } : {}),
    },
    effects: { network: false, fs: false, db: false, external_services: [] },
    integration: {
      strategy: "dependency",
      install: `pnpm add ${entry.package}@${meta.version}`,
      ...(types && entry.types ? { types: `${entry.types}@${types.version}` } : {}),
      config: [],
      migrations: false,
    },
    quality: {
      tests: { command: "pending certification (contract.test.ts in the sandbox)", passed: false },
    },
    security: {
      scanned_at: today,
      tools: ["osv.dev-api"],
      findings: advisories,
      scope:
        "Known advisories for this exact version (OSV). Transitive dependencies are scanned when the component is assembled.",
    },
    license: { declared: license, detected: license, obligations: ["preserve-notice"] },
    evidence: [
      {
        claim: `License ${license}`,
        origin: "maintainer",
        ref: `npm registry metadata ${entry.package}@${meta.version}`,
      },
      {
        claim: `${advisories.length} OSV advisories for ${entry.package}@${meta.version} on ${today}`,
        origin: "tested",
        ref: "https://api.osv.dev/v1/query",
      },
    ],
    relations: { requires: [], provides: entry.provides, conflicts: [], tested_with: [] },
  };
  const dir = join(componentsDir, entry.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "component.yaml"), stringify(manifest, { lineWidth: 120 }));
  return { id: entry.id, version: meta.version, license, advisories };
}
