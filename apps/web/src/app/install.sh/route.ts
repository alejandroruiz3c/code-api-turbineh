/**
 * GET /install.sh — one-command install of the `turbineh` CLI (PLAN §16.4):
 *   curl -fsSL https://software.turbineh.com/install.sh | sh
 * Downloads one dependency-free file (Node ≥ 20) into ~/.turbineh/bin. Public: no token needed to install.
 */
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  const base = new URL(req.url).origin;
  const script = `#!/bin/sh
# TurbineH CLI installer — verified software capabilities for people and coding agents.
set -eu
BASE="\${TURBINEH_URL:-${base}}"
if ! command -v node >/dev/null 2>&1; then
  echo "turbineh needs Node.js 20 or later: https://nodejs.org" >&2; exit 1
fi
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 20 ]; then echo "turbineh needs Node.js 20 or later (found $(node -v))" >&2; exit 1; fi
DIR="\${TURBINEH_HOME:-$HOME/.turbineh}"
mkdir -p "$DIR/bin"
curl -fsSL "$BASE/cli/turbineh.mjs" -o "$DIR/bin/turbineh.mjs"
# The CLI talks to the server it was installed from unless TURBINEH_URL or "turbineh login --url" says otherwise.
printf '#!/bin/sh\\nexport TURBINEH_INSTALL_URL="%s"\\nexec node "%s/bin/turbineh.mjs" "$@"\\n' "$BASE" "$DIR" > "$DIR/bin/turbineh"
chmod +x "$DIR/bin/turbineh" "$DIR/bin/turbineh.mjs"
if [ -w /usr/local/bin ] && [ ! -e /usr/local/bin/turbineh ]; then ln -s "$DIR/bin/turbineh" /usr/local/bin/turbineh; fi
echo "✔ turbineh installed in $DIR/bin"
# Not on PATH (e.g. no writable /usr/local/bin): show the full path, which also works in shells that start fresh.
CMD=turbineh
if [ "$(command -v turbineh 2>/dev/null)" = "" ]; then
  CMD="$DIR/bin/turbineh"
  echo "  Not on your PATH: run it as $CMD (or: export PATH=\"$DIR/bin:\$PATH\")"
fi
echo ""
echo "Next (TURBINEH_TOKEN in the environment replaces login):"
echo "  $CMD login <your access token>"
echo "  cd your-project && $CMD init --agent claude     # or codex / cursor"
echo "  $CMD build \"<what to build>\"   # or: $CMD build @spec.md"
`;
  return new Response(script, {
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
