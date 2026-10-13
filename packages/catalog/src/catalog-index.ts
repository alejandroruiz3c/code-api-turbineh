import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { readDocs } from "./docs.js";

/**
 * Agent-readable catalogue index (ADR-0032 §Documentation): `/catalog/index.json` (schema turbineh.catalog-index/v1)
 * and `/catalog/llms.txt`, generated from the manifests and docs.yaml by `pnpm catalog:index` and served by the web
 * app. Deterministic (sorted, no timestamps) so `pnpm catalog:validate` can check it is up to date.
 */
export const INDEX_SCHEMA = "turbineh.catalog-index/v1";
export const INDEX_DIR = "apps/web/public/catalog";
const SITE = "https://software.turbineh.com";

interface Manifest {
  id: string;
  version: string;
  status: string;
  category: string;
  source: { purl: string };
  capability: { does: string; does_not?: string };
  license: { detected: string };
  relations: { provides: string[] };
}

export function buildIndex(componentsDir: string): { json: string; llms: string } {
  const components = readdirSync(componentsDir)
    .sort()
    .map((id) => {
      const m = parse(readFileSync(join(componentsDir, id, "component.yaml"), "utf8")) as Manifest;
      const d = readDocs(join(componentsDir, id));
      return {
        id: m.id,
        version: m.version,
        status: m.status,
        category: m.category,
        package: m.source.purl,
        license: m.license.detected,
        provides: m.relations.provides,
        does: m.capability.does,
        ...(m.capability.does_not ? { doesNot: m.capability.does_not } : {}),
        ...(d
          ? {
              title: d.title,
              summary: d.summary,
              useCases: d.use_cases,
              useWhen: d.use_when,
              avoidWhen: d.avoid_when,
              tradeoffs: d.tradeoffs,
              config: d.config,
              interfaces: d.interfaces,
              extensionPoints: d.extension_points,
              compatibility: d.compatibility,
              security: d.security,
              guarantees: d.guarantees,
              limits: d.limits,
              example: d.example,
              keywords: d.keywords,
              ...(d.synonyms ? { synonyms: d.synonyms } : {}),
              ...(d.generated ? { generated: { by: d.generated.by, at: d.generated.at } } : {}),
            }
          : {}),
        details: `${SITE}/v1/capabilities/${m.id}`,
      };
    });
  const json = `${JSON.stringify(
    {
      schema: INDEX_SCHEMA,
      about:
        "Verified software components of the TurbineH catalogue: what each does, when to use it and not, interfaces, tested guarantees and a minimal example. Search: GET /v1/capabilities?q=… or `turbineh search`.",
      components,
    },
    null,
    2,
  )}\n`;
  const approved = components.filter((c) => c.status === "approved");
  const llms = `# TurbineH catalogue

> ${approved.length} verified components (licence, security scan and contract tests checked) that TurbineH selects
> for apps. Full machine-readable index: ${SITE}/catalog/index.json · details per component:
> ${SITE}/v1/capabilities/<id> · CLI: \`turbineh search "<need>"\`.

${approved
  .map((c) => {
    const use = "useWhen" in c && c.useWhen?.[0] ? ` Use when: ${c.useWhen[0]}` : "";
    const not = "avoidWhen" in c && c.avoidWhen?.[0] ? ` Not when: ${c.avoidWhen[0]}.` : "";
    return `- [${c.id}](${c.details}): ${c.does}.${use}${not} Provides ${c.provides.join(", ")}.`;
  })
  .join("\n")}
`;
  return { json, llms };
}
