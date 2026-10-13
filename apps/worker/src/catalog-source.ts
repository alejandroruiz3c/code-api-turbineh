import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decisionCard, readDocs, readGuides } from "@turbineh/catalog";
import type { ExternalComponent } from "@turbineh/integrator";
import type { CandidateCard } from "@turbineh/selector";
import { parse } from "yaml";

interface Manifest {
  id: string;
  status: CandidateCard["status"];
  source: { purl: string };
  capability: { does: string; does_not: string };
  integration?: { types?: string };
  compat: { peer?: Record<string, string> };
  license: { declared: string; detected: string };
  relations: { requires: string[]; provides: string[]; conflicts: string[] };
}

/**
 * Catalog manifests from git (source of truth), as decider-ready candidate cards. The card is the compact form of the
 * component's documentation (docs.yaml: what it does, when to use it and not, main trade-off, tested guarantees);
 * `docs: false` keeps the manifest one-liner (selection bench baseline).
 */
export function loadCatalog(componentsDir: string, opts: { docs?: boolean } = {}): CandidateCard[] {
  // Measured on the selection bench (bench/results/2026-10-13-selection-*.json): documentation cards did not beat the
  // manifest one-liners (16/19 vs 17/19), so they are opt-in (DECIDER_DOC_CARDS=1) until a bench run shows a gain.
  const useDocs = opts.docs ?? process.env.DECIDER_DOC_CARDS === "1";
  return readdirSync(componentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      m: parse(readFileSync(join(componentsDir, d.name, "component.yaml"), "utf8")) as Manifest,
      docs: useDocs ? readDocs(join(componentsDir, d.name)) : null,
    }))
    .map(({ m, docs }) => {
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
        card: docs
          ? decisionCard(docs, m.relations.provides)
          : `${m.capability.does}. Provides: ${m.relations.provides.join(", ")}.${guideCard(join(componentsDir, m.id))}`,
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
    ...(m.integration?.types ? { typesPkg: m.integration.types } : {}),
    dir,
  };
}

/** Guide hints for the decider (ADR-0033): when to use / avoid the component and its search keywords. */
function guideCard(dir: string): string {
  const [g] = readGuides(dir).filter((x) => !x.part);
  if (!g) return "";
  return ` Use when: ${g.use_when.slice(0, 3).join("; ")}. Avoid when: ${g.avoid_when.slice(0, 3).join("; ")}. Keywords: ${g.keywords.slice(0, 20).join(", ")}.`;
}
