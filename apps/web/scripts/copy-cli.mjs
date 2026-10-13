// Copies the bundled `turbineh` CLI into public/ before `next build`. The CLI package's own build also copies it, but
// a cached build (turbo restores only dist/**) skips that step, which left /cli/turbineh.mjs missing in production.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(web, "..", "..", "packages", "cli", "dist", "turbineh.mjs");
if (!existsSync(src)) throw new Error(`CLI bundle missing at ${src}: build @turbineh/cli first`);
mkdirSync(join(web, "public", "cli"), { recursive: true });
copyFileSync(src, join(web, "public", "cli", "turbineh.mjs"));
console.log("copied turbineh CLI into public/cli");
