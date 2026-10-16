/**
 * Which surface started a flow (ADR-0061), recorded as `options.channel` on the build row so the owner report can
 * split usage by web, CLI, MCP and API. Derived from the request only:
 *  - the TurbineH CLI sends `User-Agent: turbineh-cli/<version>`, and `turbineh-cli/<version> mcp` when the call comes
 *    from its MCP server (`turbineh mcp`, used by coding agents);
 *  - any other `Authorization: Bearer` caller is the API;
 *  - everything else is the web app (browser cookie).
 * Flows recorded before this field show as `unrecorded` (or `api` when an API key started them).
 */
export type Channel = "web" | "cli" | "mcp" | "api";

export function requestChannel(headers: Headers): Channel {
  const ua = headers.get("user-agent") ?? "";
  if (/^turbineh-cli\//i.test(ua)) return /\bmcp\b/i.test(ua) ? "mcp" : "cli";
  if ((headers.get("authorization") ?? "").startsWith("Bearer ")) return "api";
  return "web";
}
