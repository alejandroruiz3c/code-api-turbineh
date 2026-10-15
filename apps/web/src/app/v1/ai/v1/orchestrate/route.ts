import { engine } from "@turbineh/orchestration/engine";
import { gatewayDeps } from "@/server/ai-gateway-deps";
import { handleOrchestration } from "@/server/ai-orchestration";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /v1/ai/v1/orchestrate — one orchestrated request (plan, decision, answer), by TurbineH (ADR-0053). */
export function POST(req: Request): Promise<Response> {
  return handleOrchestration(req, "orchestrate", gatewayDeps(), engine);
}
