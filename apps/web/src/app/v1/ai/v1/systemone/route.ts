import { handleGateway } from "@/server/ai-gateway";
import { gatewayDeps } from "@/server/ai-gateway-deps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /v1/ai/v1/systemone — TurbineH AI gateway to JEV (SystemOne request shape of the TypeSafe SDK, ADR-0029). */
export function POST(req: Request): Promise<Response> {
  return handleGateway(req, "decider", gatewayDeps());
}
