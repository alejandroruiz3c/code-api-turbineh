/**
 * pnpm --filter @turbineh/engine gen — writes src/use-cases.generated.ts from catalog/recipes and catalog/components (the web app cannot read
 * the catalog directory at runtime). A test fails when the file is out of date.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readCatalogTotals, readUseCases, renderUseCases } from "./use-cases-source.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
writeFileSync(
  join(root, "packages/engine/src/use-cases.generated.ts"),
  renderUseCases(
    readUseCases(join(root, "catalog/recipes")),
    readCatalogTotals(join(root, "catalog/recipes")),
  ),
);
console.log("use-cases.generated.ts written");
