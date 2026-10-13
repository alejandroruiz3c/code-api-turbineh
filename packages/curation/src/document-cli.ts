/**
 * `pnpm catalog:document [<id>…] [--missing] [--all]` — the intake documentation step: documents components to the
 * standard (docs.yaml) with our open model, checking every claim against the code. Default: components whose docs
 * are missing or incomplete.
 */
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { docsIssues } from "@turbineh/catalog";
import { loadLocalEnv, readEnv } from "@turbineh/shared";
import { documentComponent } from "./document.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const componentsDir = join(repoRoot, "catalog/components");
loadLocalEnv(repoRoot);
const env = readEnv();
const args = process.argv.slice(2);
const all = readdirSync(componentsDir).sort();
const ids = args.filter((a) => !a.startsWith("--"));
const targets = ids.length
  ? ids
  : args.includes("--all")
    ? all
    : all.filter((id) => docsIssues(join(componentsDir, id), id).length > 0);
const model = {
  baseURL: env.COMPILER_BASE_URL,
  model: env.COMPILER_MODEL,
  ...(env.COMPILER_API_KEY ? { apiKey: env.COMPILER_API_KEY } : {}),
  ...(env.MODEL_REASONING_EFFORT ? { reasoningEffort: env.MODEL_REASONING_EFFORT } : {}),
};
console.log(`documenting ${targets.length} component(s) with ${model.model}`);
const queue = [...targets];
let failed = 0;
await Promise.all(
  Array.from({ length: Number(process.env.DOCUMENT_CONCURRENCY ?? 6) }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const r = await documentComponent(componentsDir, id, model).catch((e: unknown) => ({
        ok: false,
        dropped: [] as string[],
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      }));
      if (!r.ok) failed++;
      console.log(
        `${r.ok ? "documented" : "NOT documented"} ${id}${r.dropped.length ? ` · dropped ${r.dropped.length}: ${r.dropped.join("; ").slice(0, 300)}` : ""}${"error" in r && r.error ? ` · ${r.error}` : ""}`,
      );
    }
  }),
);
console.log(`${targets.length - failed}/${targets.length} documented`);
process.exitCode = failed ? 1 : 0;
