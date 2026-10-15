// Copies the bundled `turbineh` CLI into public/ before `next build`. The CLI package's own build also copies it, but
// a cached build (turbo restores only dist/**) skips that step, which left /cli/turbineh.mjs missing in production.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(web, "..", "..", "packages", "cli", "dist");
const src = join(dist, "turbineh.mjs");
if (!existsSync(src)) throw new Error(`CLI bundle missing at ${src}: build @turbineh/cli first`);
// Release artefacts (ADR-0055): the pinned versioned file, SHA256SUMS and release.json that install.sh pins.
const release = join(dist, "release.json");
if (!existsSync(release))
  throw new Error(`CLI release.json missing at ${release}: build @turbineh/cli first`);
const { file } = JSON.parse(readFileSync(release, "utf8"));
mkdirSync(join(web, "public", "cli"), { recursive: true });
for (const f of ["turbineh.mjs", file, "SHA256SUMS", "release.json"])
  copyFileSync(join(dist, f), join(web, "public", "cli", f));
console.log(`copied turbineh CLI (${file}, SHA256SUMS) into public/cli`);
