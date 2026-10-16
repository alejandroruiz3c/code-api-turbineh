import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { catalogDocs, type CatalogEntry } from "./types.js";

/** The approved catalogue from git as the product reads it from the database (approvedCatalog), for tests. */
export function catalogFromFiles(componentsDir: string): CatalogEntry[] {
  return readdirSync(componentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(componentsDir, d.name, "component.yaml")))
    .map((d) => {
      const m = parse(readFileSync(join(componentsDir, d.name, "component.yaml"), "utf8")) as {
        id: string;
        version: string;
        status: string;
        category: string;
        source: { purl: string };
        license: { detected?: string; declared?: string };
        capability: { does: string; use_cases?: string[] };
        relations: { provides: string[] };
      };
      const guide = join(componentsDir, d.name, "guide.yaml");
      return {
        status: m.status,
        entry: {
          id: m.id,
          version: m.version,
          category: m.category,
          provides: m.relations.provides,
          license: m.license.detected ?? m.license.declared ?? "",
          purl: m.source.purl,
          does: m.capability.does,
          useCases: m.capability.use_cases ?? [],
          docs: existsSync(guide) ? catalogDocs(parse(readFileSync(guide, "utf8"))) : null,
        } satisfies CatalogEntry,
      };
    })
    .filter((x) => x.status === "approved")
    .map((x) => x.entry)
    .sort((a, b) => a.id.localeCompare(b.id));
}
