import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

/**
 * Component documentation standard (ADR-0032 §Documentation): `catalog/components/<id>/docs.yaml`, schema
 * `turbineh.component-docs/v1`. Written by the intake documentation step (`pnpm catalog:document`): deterministic
 * facts from the code, manifest and tests, narrative sections drafted by our open models and then checked against
 * those facts. Used by the decider (compact card), `turbineh search`, `/v1/capabilities` and the catalogue index.
 */
export const DOCS_SCHEMA = "turbineh.component-docs/v1";

const text = z.string().min(3).max(400);
const list = (min: number, max: number) => z.array(text).min(min).max(max);

export const componentDocsSchema = z.object({
  schema: z.literal(DOCS_SCHEMA),
  id: z.string(),
  /** What it does and what it does not (from the manifest, maintained by curators). */
  does: z.string().min(3).max(800),
  does_not: z.string().max(400).optional(),
  use_cases: list(2, 8),
  when_to_use: list(1, 6),
  when_not_to_use: z
    .array(z.object({ instead: z.string().min(2).max(120), why: text }))
    .min(1)
    .max(6),
  tradeoffs: list(1, 6),
  /** Configuration and inputs the code really reads (env vars, install, config keys). Deterministic. */
  inputs: z.array(
    z.object({ name: z.string(), kind: z.enum(["env", "config", "install"]), about: z.string() }),
  ),
  /** Exports / routes the code really has (checked against the code). */
  interfaces: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        kind: z.enum(["export", "route", "component", "hook", "type", "cli"]),
        about: text,
      }),
    )
    .min(1)
    .max(12),
  extension_points: z.array(text).max(6),
  /** Package, version, peers, runtime and catalog relations. Deterministic. */
  dependencies: z.object({
    package: z.string(),
    version: z.string(),
    runtime: z.string().optional(),
    peers: z.record(z.string(), z.string()),
    requires: z.array(z.string()),
    conflicts: z.array(z.string()),
  }),
  compatibility: z.array(z.string().min(3).max(800)).min(1).max(6),
  security: list(1, 8),
  /** Each guarantee names the test that proves it (exact title in the component's tests). */
  guarantees: z
    .array(z.object({ claim: text, test: z.object({ file: z.string(), title: z.string() }) }))
    .min(1)
    .max(10),
  limits: list(1, 6),
  example: z.string().min(10).max(1500),
  keywords: z.array(z.string().min(2).max(40)).min(5).max(30),
  /** Provenance: which sections a model drafted (then checked), when, and which facts were verified by code. */
  generated: z.object({
    by: z.string(),
    at: z.string(),
    sections: z.array(z.string()),
    checked: z.array(z.string()),
  }),
});
export type ComponentDocs = z.infer<typeof componentDocsSchema>;

export const DOC_SECTIONS = [
  "does",
  "use_cases",
  "when_to_use",
  "when_not_to_use",
  "tradeoffs",
  "inputs",
  "interfaces",
  "extension_points",
  "dependencies",
  "compatibility",
  "security",
  "guarantees",
  "limits",
  "example",
  "keywords",
] as const;

export function readDocs(componentDir: string): ComponentDocs | null {
  const p = join(componentDir, "docs.yaml");
  if (!existsSync(p)) return null;
  const r = componentDocsSchema.safeParse(parse(readFileSync(p, "utf8")));
  return r.success ? r.data : null;
}

/** Completeness: missing docs mean "document it" (pnpm catalog:document <id>), never "reject". */
export function docsIssues(componentDir: string, id: string): string[] {
  const p = join(componentDir, "docs.yaml");
  if (!existsSync(p)) return [`no docs.yaml — document it: pnpm catalog:document ${id}`];
  const r = componentDocsSchema.safeParse(parse(readFileSync(p, "utf8")));
  if (!r.success)
    return [
      `docs.yaml incomplete (${r.error.issues
        .slice(0, 4)
        .map((i) => i.path.join(".") || "/")
        .join(", ")}) — document it: pnpm catalog:document ${id}`,
    ];
  return r.data.id === id ? [] : [`docs.yaml id "${r.data.id}" must equal "${id}"`];
}

/**
 * Compact card for the decider: what it does, what it is best for and its search keywords. Only positive,
 * discriminating facts: limits and "avoid when" read as risk to the risk question and lowered selection quality on the
 * selection bench (bench/results/*-selection-*.json); they stay in the full docs, search and the index.
 */
export function decisionCard(d: ComponentDocs, provides: string[]): string {
  const parts = [
    `${d.does.replace(/\.$/, "")}.`,
    `Use cases: ${d.use_cases.slice(0, 2).join("; ").replace(/\.$/, "")}.`,
    `Provides: ${provides.join(", ")}.`,
  ];
  return parts.join(" ").replace(/\s+/g, " ").slice(0, 600);
}

/** Text used for search (CLI, API, index). */
export function searchText(d: ComponentDocs): string {
  return [
    d.does,
    ...d.use_cases,
    ...d.when_to_use,
    ...d.keywords,
    ...d.interfaces.map((i) => i.name),
  ]
    .join(" ")
    .toLowerCase();
}
