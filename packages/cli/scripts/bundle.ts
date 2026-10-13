/**
 * Bundles the CLI into one dependency-free file (Node ≥ 20) and copies it where the web app serves it
 * (`/cli/turbineh.mjs`, installed by `curl -fsSL https://software.turbineh.com/install.sh | sh`).
 */
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFoundation } from "@turbineh/engine";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "dist", "turbineh.mjs");
// Security Pack basics + verified versions, embedded so `turbineh build` adapts packages locally without the catalog.
const foundation = loadFoundation(
  join(here, "..", "..", "..", "catalog", "recipes", "saas-crud", "template"),
);
await build({
  entryPoints: [join(here, "..", "src", "index.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // createRequire: bundled CommonJS dependencies (yaml, used by the local gate's OSV check) require Node built-ins.
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __turbinehRequire } from "node:module";\nconst require = __turbinehRequire(import.meta.url);',
  },
  legalComments: "none",
  define: {
    __TURBINEH_FOUNDATION__: JSON.stringify(foundation),
    // The gate's own Semgrep rules, so `turbineh verify --full` runs exactly them (ADR-0040 G4c).
    __TURBINEH_SEMGREP_RULES__: JSON.stringify(
      readFileSync(join(here, "..", "..", "verifier", "rules", "turbineh-security.yml"), "utf8"),
    ),
  },
  logLevel: "warning",
});
chmodSync(out, 0o755);
const publicDir = join(here, "..", "..", "..", "apps", "web", "public", "cli");
mkdirSync(publicDir, { recursive: true });
copyFileSync(out, join(publicDir, "turbineh.mjs"));
console.log("turbineh CLI bundled");
