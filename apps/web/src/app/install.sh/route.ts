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
printf '#!/bin/sh\\nexec node "%s/bin/turbineh.mjs" "$@"\\n' "$DIR" > "$DIR/bin/turbineh"
chmod +x "$DIR/bin/turbineh" "$DIR/bin/turbineh.mjs"
if [ -w /usr/local/bin ] && [ ! -e /usr/local/bin/turbineh ]; then ln -s "$DIR/bin/turbineh" /usr/local/bin/turbineh; fi
echo "✔ turbineh installed in $DIR/bin"
case ":$PATH:" in *":$DIR/bin:"*|*":/usr/local/bin:"*) ;; *) echo "  Add it to your PATH: export PATH=\\"$DIR/bin:\\$PATH\\"";; esac
echo ""
echo "Next:"
echo "  turbineh login <your access token>"
echo "  cd your-project && turbineh init"
echo '  turbineh search "AI support agent"'
`;
  return new Response(script, {
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
