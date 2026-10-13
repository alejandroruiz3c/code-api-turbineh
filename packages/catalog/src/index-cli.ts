/** `pnpm catalog:index` — writes the agent-readable catalogue index (apps/web/public/catalog/{index.json,llms.txt}). */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, INDEX_DIR } from "./catalog-index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const { json, llms } = buildIndex(join(repoRoot, "catalog/components"));
mkdirSync(join(repoRoot, INDEX_DIR), { recursive: true });
writeFileSync(join(repoRoot, INDEX_DIR, "index.json"), json);
writeFileSync(join(repoRoot, INDEX_DIR, "llms.txt"), llms);
console.log(`catalogue index written to ${INDEX_DIR}/ (index.json, llms.txt)`);
