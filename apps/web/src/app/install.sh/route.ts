import { cliRelease, installScript, noReleaseScript } from "@/server/install-script";

/**
 * GET /install.sh — one-command install of the `turbineh` CLI (PLAN §16.4):
 *   curl -fsSL https://software.turbineh.com/install.sh -o install.sh && sh install.sh
 * Installs one pinned, dependency-free file (Node ≥ 20) into ~/.turbineh/bin after verifying its SHA-256 (ADR-0055).
 * Public: no token needed to install.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const base = new URL(req.url).origin;
  const release = await cliRelease(base);
  return new Response(release ? installScript(base, release) : noReleaseScript, {
    status: release ? 200 : 503,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": release ? "public, max-age=300" : "no-store",
    },
  });
}
