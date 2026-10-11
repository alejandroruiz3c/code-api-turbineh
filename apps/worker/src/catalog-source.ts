import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExternalComponent } from "@turbineh/integrator";
import type { CandidateCard } from "@turbineh/selector";
import { parse } from "yaml";

interface Manifest {
  id: string;
  status: CandidateCard["status"];
  source: { purl: string };
  capability: { does: string; does_not: string };
  compat: { peer?: Record<string, string> };
  license: { declared: string; detected: string };
  relations: { requires: string[]; provides: string[]; conflicts: string[] };
}

/** Catalog manifests from git (source of truth), as decider-ready candidate cards. */
export function loadCatalog(componentsDir: string): CandidateCard[] {
  return readdirSync(componentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map(
      (d) => parse(readFileSync(join(componentsDir, d.name, "component.yaml"), "utf8")) as Manifest,
    )
    .map((m) => {
      const purl = /^pkg:[a-z]+\/(.+)@([^@]+)$/.exec(m.source.purl);
      return {
        id: m.id,
        status: m.status,
        provides: m.relations.provides,
        pkg: { name: purl?.[1] ?? m.id, version: purl?.[2] ?? "0.0.0" },
        license: m.license,
        peer: m.compat.peer ?? {},
        conflicts: m.relations.conflicts,
        requires: m.relations.requires,
        card: `${m.capability.does}. Provides: ${m.relations.provides.join(", ")}.`,
      };
    });
}

/** Candidates per capability: components that declare they provide it (approved or evaluated). */
export function candidatesFor(
  capabilities: string[],
  catalog: CandidateCard[],
): Record<string, CandidateCard[]> {
  return Object.fromEntries(
    capabilities.map((cap) => [
      cap,
      catalog.filter(
        (c) => c.provides.includes(cap) && (c.status === "approved" || c.status === "evaluated"),
      ),
    ]),
  );
}

/** Integration card for an approved dependency component (versions from the manifest, never from a model). */
export function externalComponent(
  componentsDir: string,
  id: string,
  capability: string,
  label: string,
): ExternalComponent {
  const dir = join(componentsDir, id);
  const m = parse(readFileSync(join(dir, "component.yaml"), "utf8")) as Manifest;
  const purl = /^pkg:[a-z]+\/(.+)@([^@]+)$/.exec(m.source.purl);
  if (!purl?.[1] || !purl[2]) throw new Error(`component ${id} has no installable purl`);
  return {
    id,
    capability,
    label,
    pkg: { name: purl[1], version: purl[2] },
    does: m.capability.does,
    doesNot: m.capability.does_not,
    dir,
  };
}
