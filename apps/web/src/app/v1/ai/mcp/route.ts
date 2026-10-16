import { engine } from "@turbineh/orchestration/engine";
import { gatewayDeps } from "@/server/ai-gateway-deps";
import { handleMcp } from "@/server/ai-mcp";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** /v1/ai/mcp — remote MCP server of Intelligence Orchestration, Streamable HTTP, stateless (ADR-0059). */
export function POST(req: Request): Promise<Response> {
  return handleMcp(req, gatewayDeps(), engine);
}
export function GET(req: Request): Promise<Response> {
  return handleMcp(req, gatewayDeps(), engine);
}
export function DELETE(req: Request): Promise<Response> {
  return handleMcp(req, gatewayDeps(), engine);
}
