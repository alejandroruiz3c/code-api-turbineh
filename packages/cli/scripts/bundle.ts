/**
 * Bundles the CLI into one dependency-free file (Node ≥ 20) and copies it where the web app serves it
 * (`/cli/turbineh.mjs`, installed by `install.sh`, which pins the version and verifies the SHA-256).
 */
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFoundation } from "@turbineh/engine";
import { build } from "esbuild";
import { VERSION } from "../src/context.js";

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
// Release artefacts (ADR-0055): a pinned, versioned file and its SHA-256, so install.sh verifies what it installs and
// anyone can check a manual download (`shasum -a 256 -c SHA256SUMS --ignore-missing`).
const pinned = `turbineh-${VERSION}.mjs`;
copyFileSync(out, join(dirname(out), pinned));
const sha256 = createHash("sha256").update(readFileSync(out)).digest("hex");
writeFileSync(join(dirname(out), "SHA256SUMS"), `${sha256}  ${pinned}\n${sha256}  turbineh.mjs\n`);
writeFileSync(
  join(dirname(out), "release.json"),
  `${JSON.stringify({ version: VERSION, file: pinned, sha256 }, null, 2)}\n`,
);
const publicDir = join(here, "..", "..", "..", "apps", "web", "public", "cli");
mkdirSync(publicDir, { recursive: true });
for (const f of ["turbineh.mjs", pinned, "SHA256SUMS", "release.json"])
  copyFileSync(join(dirname(out), f), join(publicDir, f));
console.log(`turbineh CLI ${VERSION} bundled (sha256 ${sha256})`);
