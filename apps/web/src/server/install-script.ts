import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The published CLI release (written by `@turbineh/cli` build next to the bundle: public/cli/release.json). */
export interface CliRelease {
  version: string;
  file: string;
  sha256: string;
}

const isRelease = (r: unknown): r is CliRelease =>
  typeof r === "object" &&
  r !== null &&
  /^\d+\.\d+\.\d+$/.test(String((r as CliRelease).version)) &&
  /^turbineh-\d+\.\d+\.\d+\.mjs$/.test(String((r as CliRelease).file)) &&
  /^[0-9a-f]{64}$/.test(String((r as CliRelease).sha256));

/** release.json from the deployment's public/cli (traced into the function), else from the serving origin. */
export async function cliRelease(origin: string): Promise<CliRelease | null> {
  try {
    const local = JSON.parse(
      readFileSync(join(process.cwd(), "public", "cli", "release.json"), "utf8"),
    ) as unknown;
    if (isRelease(local)) return local;
  } catch {
    // not traced into this function: ask the origin
  }
  try {
    const res = await fetch(`${origin}/cli/release.json`, { signal: AbortSignal.timeout(5000) });
    const body = res.ok ? ((await res.json()) as unknown) : null;
    return isRelease(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * The installer (ADR-0055): a pinned CLI version and its SHA-256, verified before anything is installed. A mismatch
 * (or no sha256sum/shasum) stops the install and leaves nothing behind.
 */
export function installScript(base: string, release: CliRelease): string {
  return `#!/bin/sh
# TurbineH CLI installer — verified software capabilities for people and coding agents.
# Pinned: turbineh ${release.version}, SHA-256 ${release.sha256}
# Checksums of every published file: ${base}/cli/SHA256SUMS
set -eu
BASE="\${TURBINEH_URL:-${base}}"
VERSION="${release.version}"
FILE="${release.file}"
SHA256="${release.sha256}"
if ! command -v node >/dev/null 2>&1; then
  echo "turbineh needs Node.js 20 or later: https://nodejs.org" >&2; exit 1
fi
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 20 ]; then echo "turbineh needs Node.js 20 or later (found $(node -v))" >&2; exit 1; fi
if command -v sha256sum >/dev/null 2>&1; then SUM="sha256sum"
elif command -v shasum >/dev/null 2>&1; then SUM="shasum -a 256"
else echo "turbineh install needs sha256sum or shasum to verify the download" >&2; exit 1; fi
DIR="\${TURBINEH_HOME:-$HOME/.turbineh}"
mkdir -p "$DIR/bin"
TMP="$DIR/bin/.turbineh.mjs.download"
trap 'rm -f "$TMP"' EXIT
curl -fsSL "$BASE/cli/$FILE" -o "$TMP"
GOT=$($SUM "$TMP" | cut -d' ' -f1)
if [ "$GOT" != "$SHA256" ]; then
  echo "turbineh $VERSION: checksum mismatch (expected $SHA256, got $GOT). Nothing was installed." >&2; exit 1
fi
mv "$TMP" "$DIR/bin/turbineh.mjs"
# The CLI talks to the server it was installed from unless TURBINEH_URL or "turbineh login --url" says otherwise.
printf '#!/bin/sh\\nexport TURBINEH_INSTALL_URL="%s"\\nexec node "%s/bin/turbineh.mjs" "$@"\\n' "$BASE" "$DIR" > "$DIR/bin/turbineh"
chmod +x "$DIR/bin/turbineh" "$DIR/bin/turbineh.mjs"
if [ -w /usr/local/bin ] && [ ! -e /usr/local/bin/turbineh ]; then ln -s "$DIR/bin/turbineh" /usr/local/bin/turbineh; fi
echo "✔ turbineh $VERSION installed in $DIR/bin (SHA-256 verified)"
# Not on PATH (e.g. no writable /usr/local/bin): show the full path, which also works in shells that start fresh.
CMD=turbineh
if [ "$(command -v turbineh 2>/dev/null)" = "" ]; then
  CMD="$DIR/bin/turbineh"
  echo "  Not on your PATH: run it as $CMD (or add $DIR/bin to your PATH)"
fi
echo ""
echo "Next (TURBINEH_TOKEN in the environment replaces login):"
echo "  $CMD login     # paste your access token: it is not shown and stays out of your shell history"
echo "  cd your-project && $CMD init --agent claude     # or codex / cursor"
echo "  $CMD build '<what to build>'   # or: $CMD build @spec.md"
`;
}

/** Served when no release is published: fails loudly instead of installing something unverified. */
export const noReleaseScript = `#!/bin/sh
echo "No verified turbineh release is published on this server yet; nothing was installed." >&2
exit 1
`;
