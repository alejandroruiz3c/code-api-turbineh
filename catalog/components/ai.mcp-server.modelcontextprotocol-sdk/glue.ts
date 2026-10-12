import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * MCP server that exposes the app's own tools to AI agents. It never calls a model. Register only read-only or
 * reversible tools here; actions with side effects need the AI Safety Pack's confirmation flow, and every tool must
 * check the caller's permissions (require* helpers) inside its handler.
 */
export function createAppToolServer(name: string, version = "1.0.0"): McpServer {
  if (!/^[a-z0-9-]{2,40}$/.test(name)) throw new Error("Invalid server name");
  return new McpServer({ name, version });
}
