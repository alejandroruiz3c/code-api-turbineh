import { handleGateway } from "@/server/ai-gateway";
import { gatewayDeps } from "@/server/ai-gateway-deps";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /v1/ai/v1/chat/completions — TurbineH AI gateway, OpenAI-compatible subset (ADR-0029). */
export function POST(req: Request): Promise<Response> {
  return handleGateway(req, "chat", gatewayDeps());
}
