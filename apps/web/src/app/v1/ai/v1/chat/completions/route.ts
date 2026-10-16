import { engine } from "@turbineh/orchestration/engine";
import { gatewayDeps } from "@/server/ai-gateway-deps";
import { handleChatCompletions } from "@/server/ai-orchestration";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /v1/ai/v1/chat/completions — TurbineH AI gateway, OpenAI-compatible subset (ADR-0029). `model:
 * "turbineh-orchestration"` (or "auto") is answered by the orchestration (ADR-0059); an allowed model id goes to that
 * model.
 */
export function POST(req: Request): Promise<Response> {
  return handleChatCompletions(req, gatewayDeps(), engine);
}
