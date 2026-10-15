import { engine } from "@turbineh/orchestration/engine";
import { gatewayDeps } from "@/server/ai-gateway-deps";
import { handleOrchestration } from "@/server/ai-orchestration";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /v1/ai/v1/agent — one step of an agent turn, orchestrated by TurbineH (ADR-0053). */
export function POST(req: Request): Promise<Response> {
  return handleOrchestration(req, "agent", gatewayDeps(), engine);
}
